import { Dialog, DialogTitle } from "@radix-ui/react-dialog";
import { DialogContent, DialogHeader } from "./ui/dialog";
import { Button } from "./ui/button";
import { BugIcon } from "lucide-react";

interface BugScreenshotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  handleReportBug: () => Promise<void>;
  isLoading: boolean;
}
export function BugScreenshotDialog({
  isOpen,
  onClose,
  handleReportBug,
  isLoading,
}: BugScreenshotDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col space-y-4 w-full">
          <p className="text-sm text-muted-foreground px-2">
            We'll prepare your report with system info and logs. Screenshot
            capture is not available in web mode.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              handleReportBug();
            }}
            className="w-full py-6 bg-(--background-lightest)"
          >
            <BugIcon className="mr-2 h-5 w-5" />{" "}
            {isLoading ? "Preparing Report..." : "File bug report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
