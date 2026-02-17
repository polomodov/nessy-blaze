(() => {
  async function captureScreenshot() {
    try {
      // Use html-to-image if available
      if (typeof htmlToImage !== "undefined") {
        return await htmlToImage.toPng(document.body, {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        });
      }
      throw new Error("html-to-image library not found");
    } catch (error) {
      console.error("[blaze-screenshot] Failed to capture screenshot:", error);
      throw error;
    }
  }
  async function handleScreenshotRequest() {
    try {
      console.debug("[blaze-screenshot] Capturing screenshot...");

      const dataUrl = await captureScreenshot();

      console.debug("[blaze-screenshot] Screenshot captured successfully");

      // Send success response to parent
      window.parent.postMessage(
        {
          type: "blaze-screenshot-response",
          success: true,
          dataUrl: dataUrl,
        },
        "*",
      );
    } catch (error) {
      console.error("[blaze-screenshot] Screenshot capture failed:", error);

      // Send error response to parent
      window.parent.postMessage(
        {
          type: "blaze-screenshot-response",
          success: false,
          error: error.message,
        },
        "*",
      );
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

    if (event.data.type === "blaze-take-screenshot") {
      handleScreenshotRequest();
    }
  });
})();
