import type { ChatMode } from "@/lib/schemas";

export function isBuildLikeChatMode(mode: ChatMode | undefined): boolean {
  return mode !== "ask";
}
