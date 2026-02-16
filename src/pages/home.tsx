import { BlazeWorkspace } from "@/components/workspace/BlazeWorkspace";
import type { FileAttachment } from "@/ipc/ipc_types";

export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
}

export default function HomePage() {
  return <BlazeWorkspace />;
}
