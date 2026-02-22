(() => {
  const OVERLAY_CLASS = "__blaze_overlay__";
  let overlays = [];
  let hoverOverlay = null;
  let hoverLabel = null;
  let currentHoveredElement = null;
  let highlightedElement = null;
  let componentCoordinates = null; // Store the last selected component's coordinates
  let isProMode = false; // Track if pro mode is enabled
  let runtimeIdCounter = 0;
  let selectableObserver = null;
  let selectableRefreshTimer = null;
  const SELECTABLE_STYLE_ID = "__blaze_selectable_components_style__";
  const EXCLUDED_TAGS = new Set([
    "HTML",
    "HEAD",
    "BODY",
    "SCRIPT",
    "STYLE",
    "META",
    "LINK",
    "TITLE",
    "NOSCRIPT",
  ]);
  const INTERACTIVE_TAGS = new Set([
    "A",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "OPTION",
    "SUMMARY",
    "LABEL",
    "DETAILS",
  ]);
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "menuitem",
    "tab",
    "checkbox",
    "switch",
    "radio",
    "option",
    "textbox",
    "combobox",
    "listbox",
    "slider",
    "spinbutton",
  ]);
  //detect if the user is using Mac
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // The possible states are:
  // { type: 'inactive' }
  // { type: 'inspecting', element: ?HTMLElement }
  // { type: 'selected', element: HTMLElement }
  let state = { type: "inactive" };

  /* ---------- helpers --------------------------------------------------- */
  const css = (el, obj) => Object.assign(el.style, obj);

  function generateRuntimeId() {
    runtimeIdCounter += 1;
    return `blaze-${Date.now().toString(36)}-${runtimeIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureSelectableStylesInserted() {
    if (!document.head) {
      return;
    }

    if (document.getElementById(SELECTABLE_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = SELECTABLE_STYLE_ID;
    style.textContent = `
      [data-blaze-selectable="true"] {
        outline: 1px dashed rgba(127, 34, 254, 0.45);
        outline-offset: 1px;
      }
    `;

    document.head.appendChild(style);
  }

  function sanitizeDomPathSegment(value) {
    return value.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-");
  }

  function buildDomPath(el, maxDepth = 10) {
    const segments = [];
    let current = el;
    let depth = 0;

    while (
      current &&
      current instanceof Element &&
      current !== document.body &&
      depth < maxDepth
    ) {
      const parent = current.parentElement;
      const tag = current.tagName.toLowerCase();

      if (!parent) {
        segments.unshift(sanitizeDomPathSegment(tag));
        break;
      }

      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }

      segments.unshift(sanitizeDomPathSegment(`${tag}-${index}`));
      current = parent;
      depth += 1;
    }

    return segments.join("/");
  }

  function hasDirectTextNode(el) {
    for (const node of el.childNodes) {
      if (
        node.nodeType === Node.TEXT_NODE &&
        typeof node.textContent === "string" &&
        node.textContent.trim().length > 0
      ) {
        return true;
      }
    }

    return false;
  }

  function isElementInspectableCandidate(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }

    if (
      el.classList.contains(OVERLAY_CLASS) ||
      el.closest(`.${OVERLAY_CLASS}`)
    ) {
      return false;
    }

    if (EXCLUDED_TAGS.has(el.tagName)) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < 6 || rect.height < 6) {
      return false;
    }

    const computed = window.getComputedStyle(el);
    if (
      computed.display === "none" ||
      computed.visibility === "hidden" ||
      computed.opacity === "0"
    ) {
      return false;
    }

    if (
      typeof el.dataset.blazeId === "string" &&
      el.dataset.blazeId.length > 0
    ) {
      return true;
    }

    if (INTERACTIVE_TAGS.has(el.tagName)) {
      return true;
    }

    const role = el.getAttribute("role")?.toLowerCase();
    if (role && INTERACTIVE_ROLES.has(role)) {
      return true;
    }

    if (el.isContentEditable || el.tabIndex >= 0) {
      return true;
    }

    if (el.hasAttribute("onclick") || typeof el.onclick === "function") {
      return true;
    }

    if (computed.cursor === "pointer") {
      return true;
    }

    return hasDirectTextNode(el);
  }

  function notifySelectableCount(count) {
    window.parent.postMessage(
      {
        type: "blaze-selectable-components-updated",
        count,
      },
      "*",
    );
  }

  function normalizeSourcePath(fileName) {
    if (typeof fileName !== "string" || fileName.length === 0) {
      return null;
    }

    let normalized = fileName;

    if (/^https?:\/\//i.test(normalized)) {
      try {
        normalized = new URL(normalized).pathname;
      } catch {
        return null;
      }
    }

    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep original value when path is not URI-encoded.
    }

    normalized = normalized.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, "");

    const lowerNormalized = normalized.toLowerCase();
    const srcIndex = lowerNormalized.lastIndexOf("/src/");
    if (srcIndex >= 0) {
      return normalized.slice(srcIndex + 1);
    }

    const appIndex = lowerNormalized.lastIndexOf("/app/");
    if (appIndex >= 0) {
      return normalized.slice(appIndex + 1);
    }

    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }

    return normalized || null;
  }

  function getReactFiberNode(el) {
    for (const key of Object.keys(el)) {
      if (key.startsWith("__reactFiber$")) {
        return el[key];
      }
    }
    return null;
  }

  function getFiberDebugSource(fiber) {
    const seen = new Set();
    let current = fiber;

    while (current && !seen.has(current)) {
      seen.add(current);

      const candidateSources = [
        current._debugSource,
        current._source,
        current.elementType?._source,
        current.type?._source,
        current.memoizedProps?.__source,
        current.pendingProps?.__source,
      ];

      for (const source of candidateSources) {
        if (
          source &&
          typeof source.fileName === "string" &&
          typeof source.lineNumber === "number"
        ) {
          return source;
        }
      }

      current = current.return;
    }

    return null;
  }

  function getFiberComponentName(fiber) {
    const candidates = [
      fiber?.elementType?.displayName,
      fiber?.elementType?.name,
      fiber?.type?.displayName,
      fiber?.type?.name,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return null;
  }

  function ensureBlazeMetadataOnElement(el) {
    if (!(el instanceof Element)) {
      return false;
    }

    if (!el.dataset.blazeRuntimeId) {
      el.dataset.blazeRuntimeId = generateRuntimeId();
    }

    if (!el.dataset.blazeInstanceId) {
      el.dataset.blazeInstanceId = el.dataset.blazeRuntimeId;
    }

    if (!el.dataset.blazeName) {
      el.dataset.blazeName = el.tagName.toLowerCase();
    }

    if (typeof el.dataset.blazeId === "string" && el.dataset.blazeId.length) {
      return true;
    }

    const fiber = getReactFiberNode(el);
    const source = fiber ? getFiberDebugSource(fiber) : null;
    if (source) {
      const relativePath = normalizeSourcePath(source.fileName);
      const lineNumber = Number(source.lineNumber);
      const columnNumber = Number(source.columnNumber ?? source.column ?? 1);
      const normalizedLineNumber =
        Number.isFinite(lineNumber) && lineNumber > 0
          ? Math.floor(lineNumber)
          : 0;
      const normalizedColumnNumber = Number.isFinite(columnNumber)
        ? Math.max(1, Math.floor(columnNumber))
        : 1;

      if (relativePath && normalizedLineNumber > 0) {
        el.dataset.blazeId = `${relativePath}:${normalizedLineNumber}:${normalizedColumnNumber}`;
        const fiberName = getFiberComponentName(fiber);
        if (fiberName) {
          el.dataset.blazeName = fiberName;
        }
        return true;
      }
    }

    // Fallback when no source metadata is available: keep runtime-unique attribution.
    const domPath = buildDomPath(el);
    if (!domPath) {
      return false;
    }

    el.dataset.blazeDomPath = domPath;
    el.dataset.blazeId = `__dom__/${domPath}:1:1`;
    return true;
  }

  function clearSelectableMarkers() {
    const markedElements = document.querySelectorAll("[data-blaze-selectable]");
    for (const element of markedElements) {
      element.removeAttribute("data-blaze-selectable");
    }
  }

  function markSelectableElements(limit = 800) {
    if (!document.body) {
      notifySelectableCount(0);
      return 0;
    }

    clearSelectableMarkers();

    const elements = document.body.querySelectorAll("*");
    let count = 0;

    for (let i = 0; i < elements.length && count < limit; i += 1) {
      const element = elements[i];
      if (!isElementInspectableCandidate(element)) {
        continue;
      }

      if (!ensureBlazeMetadataOnElement(element)) {
        continue;
      }

      element.dataset.blazeSelectable = "true";
      count += 1;
    }

    notifySelectableCount(count);
    return count;
  }

  function scheduleSelectableRefresh() {
    if (selectableRefreshTimer) {
      clearTimeout(selectableRefreshTimer);
    }

    selectableRefreshTimer = setTimeout(() => {
      selectableRefreshTimer = null;
      if (state.type === "inspecting") {
        markSelectableElements();
      }
    }, 120);
  }

  function startSelectableObserver() {
    if (selectableObserver || !document.body) {
      return;
    }

    selectableObserver = new MutationObserver(() => {
      scheduleSelectableRefresh();
    });

    selectableObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "role", "aria-label"],
    });
  }

  function stopSelectableObserver() {
    if (selectableObserver) {
      selectableObserver.disconnect();
      selectableObserver = null;
    }
    if (selectableRefreshTimer) {
      clearTimeout(selectableRefreshTimer);
      selectableRefreshTimer = null;
    }
  }

  function findInspectableElement(initialTarget) {
    let el =
      initialTarget instanceof Element
        ? initialTarget
        : initialTarget?.parentElement;

    while (el) {
      if (
        isElementInspectableCandidate(el) &&
        ensureBlazeMetadataOnElement(el)
      ) {
        return el;
      }
      el = el.parentElement;
    }

    return null;
  }

  function hydrateExistingDomElements(limit = 1200) {
    if (!document.body) {
      return 0;
    }

    const elements = document.body.querySelectorAll("*");
    let hydratedCount = 0;

    for (let i = 0; i < elements.length && hydratedCount < limit; i += 1) {
      const element = elements[i];
      if (
        isElementInspectableCandidate(element) &&
        ensureBlazeMetadataOnElement(element)
      ) {
        hydratedCount += 1;
      }
    }

    return hydratedCount;
  }

  function makeOverlay() {
    const overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    css(overlay, {
      position: "absolute",
      border: "2px solid #7f22fe",
      background: "rgba(0,170,255,.05)",
      pointerEvents: "none",
      zIndex: "2147483647", // max
      borderRadius: "4px",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
    });

    const label = document.createElement("div");
    css(label, {
      position: "absolute",
      left: "0",
      top: "100%",
      transform: "translateY(4px)",
      background: "#7f22fe",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "12px",
      lineHeight: "1.2",
      padding: "3px 5px",
      whiteSpace: "nowrap",
      borderRadius: "4px",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)",
    });
    overlay.appendChild(label);
    document.body.appendChild(overlay);

    return { overlay, label };
  }

  function updateOverlay(el, isSelected = false, isHighlighted = false) {
    // If no element, hide hover overlay
    if (!el) {
      if (hoverOverlay) hoverOverlay.style.display = "none";
      return;
    }

    if (isSelected) {
      if (overlays.some((item) => item.el === el)) {
        return;
      }

      const { overlay, label } = makeOverlay();
      overlays.push({ overlay, label, el });

      const rect = el.getBoundingClientRect();
      const borderColor = isHighlighted ? "#00ff00" : "#7f22fe";
      const backgroundColor = isHighlighted
        ? "rgba(0, 255, 0, 0.05)"
        : "rgba(127, 34, 254, 0.05)";

      css(overlay, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        display: "block",
        border: `3px solid ${borderColor}`,
        background: backgroundColor,
      });

      css(label, { display: "none" });

      return;
    }

    // Otherwise, this is a hover overlay: reuse the hover overlay node
    if (!hoverOverlay || !hoverLabel) {
      const o = makeOverlay();
      hoverOverlay = o.overlay;
      hoverLabel = o.label;
    }

    const rect = el.getBoundingClientRect();
    css(hoverOverlay, {
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: "block",
      border: "2px solid #7f22fe",
      background: "rgba(0,170,255,.05)",
    });
    css(hoverLabel, { background: "#7f22fe" });
    while (hoverLabel.firstChild) hoverLabel.removeChild(hoverLabel.firstChild);
    const name = el.dataset.blazeName || "<unknown>";
    const file = (el.dataset.blazeId || "").split(":")[0];
    const nameEl = document.createElement("div");
    nameEl.textContent = name;
    hoverLabel.appendChild(nameEl);
    if (file) {
      const fileEl = document.createElement("span");
      css(fileEl, { fontSize: "10px", opacity: ".8" });
      fileEl.textContent = file.replace(/\\/g, "/");
      hoverLabel.appendChild(fileEl);
    }

    // Update positions after showing hover label in case it caused layout shift
    requestAnimationFrame(updateAllOverlayPositions);
  }

  function updateAllOverlayPositions() {
    // Update all selected overlays
    overlays.forEach(({ overlay, el }) => {
      const rect = el.getBoundingClientRect();
      css(overlay, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    });

    // Update hover overlay if visible
    if (
      hoverOverlay &&
      hoverOverlay.style.display !== "none" &&
      state.element
    ) {
      const rect = state.element.getBoundingClientRect();
      css(hoverOverlay, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }

    // Send updated coordinates for highlighted or selected component to parent
    if (highlightedElement) {
      // Multi-selector mode: send coordinates for the highlighted component
      const highlightedItem = overlays.find(
        ({ el }) => el === highlightedElement,
      );

      if (highlightedItem) {
        const rect = highlightedItem.el.getBoundingClientRect();
        window.parent.postMessage(
          {
            type: "blaze-component-coordinates-updated",
            coordinates: {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            },
          },
          "*",
        );
      }
    }
  }

  function clearOverlays() {
    overlays.forEach(({ overlay }) => overlay.remove());
    overlays = [];

    if (hoverOverlay) {
      hoverOverlay.remove();
      hoverOverlay = null;
      hoverLabel = null;
    }

    currentHoveredElement = null;
    highlightedElement = null;
  }

  function removeOverlayById(componentId) {
    // Remove all overlays with the same componentId
    const indicesToRemove = [];
    overlays.forEach((item, index) => {
      if (item.el.dataset.blazeId === componentId) {
        indicesToRemove.push(index);
      }
    });

    // Remove in reverse order to maintain correct indices
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
      const { overlay } = overlays[indicesToRemove[i]];
      overlay.remove();
      overlays.splice(indicesToRemove[i], 1);
    }

    if (
      highlightedElement &&
      highlightedElement.dataset.blazeId === componentId
    ) {
      highlightedElement = null;
    }
  }

  // Helper function to check if mouse is over the toolbar
  function isMouseOverToolbar(mouseX, mouseY) {
    if (!componentCoordinates) return false;

    // Toolbar is positioned at bottom of component: top = coordinates.top + coordinates.height + 4px
    const toolbarTop =
      componentCoordinates.top + componentCoordinates.height + 4;
    const toolbarLeft = componentCoordinates.left;
    const toolbarHeight = 60;
    // Add some padding to the width since we don't know exact width
    const toolbarWidth = componentCoordinates.width || 400;

    return (
      mouseY >= toolbarTop &&
      mouseY <= toolbarTop + toolbarHeight &&
      mouseX >= toolbarLeft &&
      mouseX <= toolbarLeft + toolbarWidth
    );
  }

  // Helper function to check if the highlighted component is inside another selected component
  function isHighlightedComponentChildOfSelected() {
    if (!highlightedElement) return null;

    const highlightedItem = overlays.find(
      ({ el }) => el === highlightedElement,
    );
    if (!highlightedItem) return null;

    // Check if any other selected component contains the highlighted element
    for (const item of overlays) {
      if (item.el === highlightedItem.el) continue; // Skip the highlighted component itself
      if (item.el.contains(highlightedItem.el)) {
        return item; // Return the parent component
      }
    }
    return null;
  }

  // Helper function to show/hide and populate label for a selected overlay
  function updateSelectedOverlayLabel(item, show) {
    const { label, el } = item;

    if (!show) {
      css(label, { display: "none" });
      // Update positions after hiding label in case it caused layout shift
      requestAnimationFrame(updateAllOverlayPositions);
      return;
    }

    // Clear and populate label
    css(label, { display: "block", background: "#7f22fe" });
    while (label.firstChild) label.removeChild(label.firstChild);

    // Add "Edit with AI" line
    const editLine = document.createElement("div");
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    Object.assign(svg.style, {
      display: "inline-block",
      verticalAlign: "-2px",
      marginRight: "4px",
    });
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute(
      "d",
      "M8 0L9.48528 6.51472L16 8L9.48528 9.48528L8 16L6.51472 9.48528L0 8L6.51472 6.51472L8 0Z",
    );
    path.setAttribute("fill", "white");
    svg.appendChild(path);
    editLine.appendChild(svg);
    editLine.appendChild(document.createTextNode("Edit with AI"));
    label.appendChild(editLine);

    // Add component name and file
    const name = el.dataset.blazeName || "<unknown>";
    const file = (el.dataset.blazeId || "").split(":")[0];
    const nameEl = document.createElement("div");
    nameEl.textContent = name;
    label.appendChild(nameEl);
    if (file) {
      const fileEl = document.createElement("span");
      css(fileEl, { fontSize: "10px", opacity: ".8" });
      fileEl.textContent = file.replace(/\\/g, "/");
      label.appendChild(fileEl);
    }

    // Update positions after showing label in case it caused layout shift
    requestAnimationFrame(updateAllOverlayPositions);
  }

  /* ---------- event handlers -------------------------------------------- */
  function onMouseMove(e) {
    // Check if mouse is over toolbar - if so, hide the label and treat as if mouse left component
    if (isMouseOverToolbar(e.clientX, e.clientY)) {
      if (currentHoveredElement) {
        const previousItem = overlays.find(
          (item) => item.el === currentHoveredElement,
        );
        if (previousItem) {
          updateSelectedOverlayLabel(previousItem, false);
        }
        currentHoveredElement = null;
      }
      return;
    }

    const el = findInspectableElement(e.target);

    const hoveredItem = overlays.find((item) => item.el === el);

    // Check if the highlighted component is a child of another selected component
    const parentOfHighlighted = isHighlightedComponentChildOfSelected();

    // If hovering over the highlighted component and it has a parent, hide the parent's label
    if (
      hoveredItem &&
      hoveredItem.el === highlightedElement &&
      parentOfHighlighted
    ) {
      // Hide the parent component's label
      updateSelectedOverlayLabel(parentOfHighlighted, false);
      // Also clear currentHoveredElement if it's the parent
      if (currentHoveredElement === parentOfHighlighted.el) {
        currentHoveredElement = null;
      }
      return;
    }

    if (currentHoveredElement && currentHoveredElement !== el) {
      const previousItem = overlays.find(
        (item) => item.el === currentHoveredElement,
      );
      if (previousItem) {
        updateSelectedOverlayLabel(previousItem, false);
      }
    }

    currentHoveredElement = el;

    // If hovering over a selected component, show its label only if it's not highlighted
    if (hoveredItem && hoveredItem.el !== highlightedElement) {
      updateSelectedOverlayLabel(hoveredItem, true);
      if (hoverOverlay) hoverOverlay.style.display = "none";
    }

    // Handle inspecting state (component selector is active)
    if (state.type === "inspecting") {
      if (state.element === el) return;
      state.element = el;

      if (!hoveredItem && el) {
        updateOverlay(el, false);
      } else if (!el) {
        if (hoverOverlay) hoverOverlay.style.display = "none";
      }
    }
  }

  function onMouseLeave(e) {
    if (!e.relatedTarget) {
      if (hoverOverlay) {
        hoverOverlay.style.display = "none";
        requestAnimationFrame(updateAllOverlayPositions);
      }
      currentHoveredElement = null;
      if (state.type === "inspecting") {
        state.element = null;
      }
    }
  }

  function isMultiSelectModifierPressed(event) {
    return isMac ? event.metaKey : event.ctrlKey;
  }

  function postComponentDeselected(el) {
    if (!el || !el.dataset) {
      return;
    }

    const componentId = el.dataset.blazeId;
    if (!componentId) {
      return;
    }

    window.parent.postMessage(
      {
        type: "blaze-component-deselected",
        componentId,
        runtimeId: el.dataset.blazeRuntimeId || undefined,
      },
      "*",
    );
  }

  function removeOverlayItem(item) {
    if (!item) {
      return;
    }
    item.overlay.remove();
    overlays = overlays.filter((candidate) => candidate !== item);
  }

  function keepOnlySelectedElement(selectedElement) {
    const nextOverlays = [];
    for (const item of overlays) {
      if (item.el === selectedElement) {
        nextOverlays.push(item);
        continue;
      }

      item.overlay.remove();
      postComponentDeselected(item.el);
    }

    overlays = nextOverlays;

    if (highlightedElement && highlightedElement !== selectedElement) {
      highlightedElement = null;
    }
  }

  function getElementTextPreview(el, maxLength = 160) {
    if (!el) {
      return undefined;
    }

    const rawText =
      typeof el.innerText === "string"
        ? el.innerText
        : typeof el.textContent === "string"
          ? el.textContent
          : "";
    const normalizedText = rawText.replace(/\s+/g, " ").trim();
    if (!normalizedText) {
      return undefined;
    }

    if (normalizedText.length <= maxLength) {
      return normalizedText;
    }

    return `${normalizedText.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  function onClick(e) {
    if (state.type !== "inspecting" || !state.element) return;
    e.preventDefault();
    e.stopPropagation();

    ensureBlazeMetadataOnElement(state.element);

    const clickedComponentId = state.element.dataset.blazeId;
    if (!clickedComponentId) {
      return;
    }
    const isMultiSelect = isMultiSelectModifierPressed(e);
    const selectedItem = overlays.find((item) => item.el === state.element);

    // Multi-select modifier toggles the clicked component only.
    if (isMultiSelect && selectedItem) {
      if (state.element.contentEditable === "true") {
        return;
      }

      removeOverlayItem(selectedItem);
      requestAnimationFrame(updateAllOverlayPositions);
      if (highlightedElement === state.element) {
        highlightedElement = null;
      }

      postComponentDeselected(state.element);
      return;
    }

    // Default click behaves as single-select: keep only the clicked component.
    if (!isMultiSelect) {
      keepOnlySelectedElement(state.element);
    }

    const selectedItemAfterCleanup = overlays.find(
      (item) => item.el === state.element,
    );

    // Update only the previously highlighted component
    if (highlightedElement && highlightedElement !== state.element) {
      const previousItem = overlays.find(
        (item) => item.el === highlightedElement,
      );
      if (previousItem) {
        css(previousItem.overlay, {
          border: `3px solid #7f22fe`,
          background: "rgba(127, 34, 254, 0.05)",
        });
      }
    }

    highlightedElement = state.element;

    if (selectedItemAfterCleanup && isProMode) {
      css(selectedItemAfterCleanup.overlay, {
        border: `3px solid #00ff00`,
        background: "rgba(0, 255, 0, 0.05)",
      });
    }

    if (!selectedItemAfterCleanup) {
      updateOverlay(state.element, true, isProMode);
      requestAnimationFrame(updateAllOverlayPositions);
    }

    const rect = state.element.getBoundingClientRect();
    window.parent.postMessage(
      {
        type: "blaze-component-selected",
        component: {
          id: clickedComponentId,
          name: state.element.dataset.blazeName,
          runtimeId: state.element.dataset.blazeRuntimeId,
          tagName: state.element.tagName
            ? state.element.tagName.toLowerCase()
            : undefined,
          textPreview: getElementTextPreview(state.element),
          domPath: state.element.dataset.blazeDomPath || undefined,
        },
        coordinates: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      },
      "*",
    );
  }

  function onKeyDown(e) {
    // Ignore keystrokes if the user is typing in an input field, textarea, or editable element
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) {
      return;
    }

    // Forward shortcuts to parent window
    const key = e.key.toLowerCase();
    const hasShift = e.shiftKey;
    const hasCtrlOrMeta = isMac ? e.metaKey : e.ctrlKey;
    if (key === "c" && hasShift && hasCtrlOrMeta) {
      e.preventDefault();
      window.parent.postMessage(
        {
          type: "blaze-select-component-shortcut",
        },
        "*",
      );
    }
  }

  /* ---------- activation / deactivation --------------------------------- */
  function activate() {
    if (state.type === "inactive") {
      window.addEventListener("click", onClick, true);
    }
    ensureSelectableStylesInserted();
    hydrateExistingDomElements();
    markSelectableElements();
    startSelectableObserver();
    state = { type: "inspecting", element: null };
  }

  function deactivate() {
    if (state.type === "inactive") return;

    window.removeEventListener("click", onClick, true);
    // Don't clear overlays on deactivate - keep selected components visible
    // Hide only the hover overlay and all labels
    if (hoverOverlay) {
      hoverOverlay.style.display = "none";
    }

    // Hide all labels when deactivating
    overlays.forEach((item) => updateSelectedOverlayLabel(item, false));
    currentHoveredElement = null;
    stopSelectableObserver();
    clearSelectableMarkers();
    notifySelectableCount(0);

    state = { type: "inactive" };
  }

  /* ---------- message bridge -------------------------------------------- */
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    if (e.data.type === "blaze-pro-mode") {
      isProMode = e.data.enabled;
    }
    if (e.data.type === "activate-blaze-component-selector") activate();
    if (e.data.type === "deactivate-blaze-component-selector") deactivate();
    if (e.data.type === "activate-blaze-visual-editing") {
      activate();
    }
    if (e.data.type === "deactivate-blaze-visual-editing") {
      deactivate();
      clearOverlays();
    }
    if (e.data.type === "clear-blaze-component-overlays") clearOverlays();
    if (e.data.type === "update-blaze-overlay-positions") {
      updateAllOverlayPositions();
    }
    if (e.data.type === "update-component-coordinates") {
      // Store component coordinates for toolbar hover detection
      componentCoordinates = e.data.coordinates;
    }
    if (
      e.data.type === "remove-blaze-component-overlay" ||
      e.data.type === "deselect-blaze-component"
    ) {
      if (e.data.componentId) {
        removeOverlayById(e.data.componentId);
      }
    }
  });

  // Always listen for keyboard shortcuts
  window.addEventListener("keydown", onKeyDown, true);

  // Always listen for mouse move to show/hide labels on selected overlays
  window.addEventListener("mousemove", onMouseMove, true);

  document.addEventListener("mouseleave", onMouseLeave, true);

  // Update overlay positions on window resize and scroll
  window.addEventListener("resize", updateAllOverlayPositions);
  window.addEventListener("scroll", updateAllOverlayPositions, true);

  function initializeComponentSelector() {
    if (!document.body) {
      console.error(
        "Blaze component selector initialization failed: document.body not found.",
      );
      return;
    }
    setTimeout(() => {
      ensureSelectableStylesInserted();
      const hydratedCount = hydrateExistingDomElements();
      if (document.body.querySelector("[data-blaze-id]")) {
        window.parent.postMessage(
          {
            type: "blaze-component-selector-initialized",
            selectableCount: hydratedCount,
          },
          "*",
        );
        console.debug("Blaze component selector initialized");
      } else {
        console.warn(
          "Blaze component selector not initialized because no DOM elements were tagged",
        );
      }
    }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeComponentSelector);
  } else {
    initializeComponentSelector();
  }
})();
