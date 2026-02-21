import {
  MiniSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { detectIsMac } from "@/hooks/useChatModeToggle";
import { cn } from "@/lib/utils";
import type { ChatMode } from "@/lib/schemas";

function normalizeChatMode(value: ChatMode | undefined): "build" | "ask" {
  return value === "ask" ? "ask" : "build";
}

export function ChatModeSelector() {
  const { settings, updateSettings } = useSettings();
  const selectedMode = normalizeChatMode(settings?.selectedChatMode);
  const isMac = detectIsMac();

  const handleModeChange = (value: string) => {
    updateSettings({ selectedChatMode: value === "ask" ? "ask" : "build" });
  };

  return (
    <Select value={selectedMode} onValueChange={handleModeChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <MiniSelectTrigger
            data-testid="chat-mode-selector"
            className={cn(
              "h-6 w-fit px-1.5 py-0 text-xs-sm font-medium shadow-none gap-0.5",
              selectedMode === "build"
                ? "bg-background hover:bg-muted/50 focus:bg-muted/50"
                : "bg-primary/10 hover:bg-primary/20 focus:bg-primary/20 text-primary border-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 dark:focus:bg-primary/30",
            )}
            size="sm"
          >
            <SelectValue>
              {selectedMode === "ask" ? "Ask" : "Build"}
            </SelectValue>
          </MiniSelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex flex-col">
            <span>Open mode menu</span>
            <span className="text-xs text-gray-200 dark:text-gray-500">
              {isMac ? "⌘ + ." : "Ctrl + ."} to toggle
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
      <SelectContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
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
  );
}
