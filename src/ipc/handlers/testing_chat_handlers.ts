import { safeSend } from "../utils/safe_sender";
import { cleanFullResponse } from "../utils/cleanFullResponse";
import type { ServerEventSink } from "../utils/server_event_sink";

const TEST_RESPONSES: Record<string, string> = {
  "ts-error": `This will get a TypeScript error.
  
  <blaze-write path="src/bad-file.ts" description="This will get a TypeScript error.">
  import NonExistentClass from 'non-existent-class';

  const x = new Object();
  x.nonExistentMethod();
  </blaze-write>
  
  EOM`,
  "add-dep": `I'll add that dependency for you.
  
  <blaze-add-dependency packages="deno"></blaze-add-dependency>
  
  EOM`,
  "add-non-existing-dep": `I'll add that dependency for you.
  
  <blaze-add-dependency packages="@angular/does-not-exist"></blaze-add-dependency>
  
  EOM`,
  "add-multiple-deps": `I'll add that dependency for you.
  
  <blaze-add-dependency packages="react-router-dom react-query"></blaze-add-dependency>
  
  EOM`,
  write: `Hello world
  <blaze-write path="src/hello.ts" content="Hello world">
  console.log("Hello world");
  </blaze-write>
  EOM`,
  "string-literal-leak": `BEFORE TAG
  <blaze-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</blaze-write>
AFTER TAG
`,
};

export function getTestResponse(prompt: string): string | null {
  const match = prompt.match(/\[blaze-qa=([^\]]+)\]/);
  if (!match) {
    return null;
  }
  return TEST_RESPONSES[match[1]] || null;
}

export async function streamTestResponse(
  eventSink: ServerEventSink,
  chatId: number,
  testResponse: string,
  abortController: AbortController,
  updatedChat: {
    messages: Array<{ role: string; content: string }>;
  },
): Promise<string> {
  const chunks = testResponse.split(" ");
  let fullResponse = "";

  for (const chunk of chunks) {
    if (abortController.signal.aborted) {
      break;
    }

    fullResponse += `${chunk} `;
    fullResponse = cleanFullResponse(fullResponse);

    safeSend(eventSink, "chat:response:chunk", {
      chatId,
      messages: [
        ...updatedChat.messages,
        {
          role: "assistant",
          content: fullResponse,
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return fullResponse;
}
