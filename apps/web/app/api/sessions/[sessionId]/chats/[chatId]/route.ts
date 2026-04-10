import { getRun } from "workflow/api";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import type { WebAgentUIMessage } from "@/app/types";
import {
  deleteChat,
  getChatMessages,
  getChatsBySessionId,
  updateChat,
  updateChatActiveStreamId,
} from "@/lib/db/sessions";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

interface UpdateChatRequest {
  title?: string;
  modelId?: string;
}

export interface ChatRefreshResponse {
  chat: {
    id: string;
    modelId: string | null;
    activeStreamId: string | null;
  };
  isStreaming: boolean;
  messages: WebAgentUIMessage[];
}

async function resolveChatStreamingState(
  chatId: string,
  activeStreamId: string | null,
): Promise<
  Pick<ChatRefreshResponse, "isStreaming"> & {
    activeStreamId: string | null;
  }
> {
  if (!activeStreamId) {
    return { activeStreamId: null, isStreaming: false };
  }

  try {
    const run = getRun(activeStreamId);
    const status = await run.status;
    if (status === "running" || status === "pending") {
      return { activeStreamId, isStreaming: true };
    }
  } catch {
    // Workflow run not found — treat as stale.
  }

  await updateChatActiveStreamId(chatId, null);
  return { activeStreamId: null, isStreaming: false };
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const [messages, streamingState] = await Promise.all([
    getChatMessages(chatId),
    resolveChatStreamingState(chatId, chatContext.chat.activeStreamId),
  ]);

  return Response.json({
    chat: {
      id: chatContext.chat.id,
      modelId: chatContext.chat.modelId,
      activeStreamId: streamingState.activeStreamId,
    },
    isStreaming: streamingState.isStreaming,
    messages: messages.map((message) => message.parts as WebAgentUIMessage),
  } satisfies ChatRefreshResponse);
}

export async function PATCH(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  let body: UpdateChatRequest;
  try {
    body = (await req.json()) as UpdateChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextTitle = body.title?.trim();
  const nextModelId = body.modelId?.trim();

  if (!nextTitle && !nextModelId) {
    return Response.json(
      { error: "At least one field is required" },
      { status: 400 },
    );
  }

  const updatePayload: { title?: string; modelId?: string } = {};
  if (nextTitle) {
    updatePayload.title = nextTitle;
  }
  if (nextModelId) {
    updatePayload.modelId = nextModelId;
  }

  const updatedChat = await updateChat(chatId, updatePayload);
  if (!updatedChat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  return Response.json({ chat: updatedChat });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const chats = await getChatsBySessionId(sessionId);
  if (chats.length <= 1) {
    return Response.json(
      { error: "Cannot delete the only chat in a session" },
      { status: 400 },
    );
  }

  await deleteChat(chatId);
  return Response.json({ success: true });
}
