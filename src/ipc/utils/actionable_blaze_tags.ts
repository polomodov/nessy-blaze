const ACTIONABLE_BLAZE_TAG_PATTERN =
  /<(blaze-(?:chat-summary|write|search-replace|rename|delete|add-dependency|command))\b[^>]*>[\s\S]*?<\/\1>/gi;

export function extractActionableBlazeTags(rawResponse: string): string {
  const actionableTags = rawResponse.match(ACTIONABLE_BLAZE_TAG_PATTERN);
  if (!actionableTags) {
    return "";
  }

  return actionableTags.join("\n\n").trim();
}
