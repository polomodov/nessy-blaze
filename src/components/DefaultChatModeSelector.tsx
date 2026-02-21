import { useSettings } from "@/hooks/useSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatMode } from "@/lib/schemas";

function normalizeDefaultMode(mode: ChatMode | undefined): "build" | "ask" {
  return mode === "ask" ? "ask" : "build";
}

export function DefaultChatModeSelector() {
  const { settings, updateSettings } = useSettings();

  if (!settings) {
    return null;
  }

  const effectiveDefault = normalizeDefaultMode(settings.defaultChatMode);

  const handleDefaultChatModeChange = (value: string) => {
    updateSettings({ defaultChatMode: value === "ask" ? "ask" : "build" });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <label
          htmlFor="default-chat-mode"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Default Chat Mode
        </label>
        <Select
          value={effectiveDefault}
          onValueChange={handleDefaultChatModeChange}
        >
          <SelectTrigger className="w-40" id="default-chat-mode">
            <SelectValue>
              {effectiveDefault === "ask" ? "Ask" : "Build"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="build">
              <div className="flex flex-col items-start">
                <span className="font-medium">Build</span>
                <span className="text-xs text-muted-foreground">
                  Generate and edit code
                </span>
              </div>
            </SelectItem>
            <SelectItem value="ask">
              <div className="flex flex-col items-start">
                <span className="font-medium">Ask</span>
                <span className="text-xs text-muted-foreground">
                  Ask questions about the app
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        The chat mode used when creating new chats.
      </div>
    </div>
  );
}
