import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";
import { getChatMessages } from "@/lib/db/sessions";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * A single message in the inbox thread view.
 * Only contains text — tool calls are stripped.
 */
export interface InboxThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

function extractPartsArray(raw: unknown): MessagePart[] {
  if (Array.isArray(raw)) return raw as MessagePart[];
  if (
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as Record<string, unknown>).parts)
  ) {
    return (raw as Record<string, unknown>).parts as MessagePart[];
  }
  return [];
}

function extractAllText(parts: MessagePart[]): string {
  return parts
    .filter(
      (p) => p.type === "text" && typeof p.text === "string" && p.text.trim(),
    )
    .map((p) => p.text!.trim())
    .join("\n\n");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { chatId } = await params;

  // Verify ownership: chat -> session -> user
  const [chat] = await db
    .select({ id: chats.id, sessionId: chats.sessionId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);

  if (!chat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  const dbMessages = await getChatMessages(chatId);

  // Build text-only thread
  const thread: InboxThreadMessage[] = [];
  for (const msg of dbMessages) {
    const parts = extractPartsArray(msg.parts);
    const text = extractAllText(parts);
    if (text) {
      thread.push({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        text,
        createdAt: msg.createdAt.toISOString(),
      });
    }
  }

  // Also return raw messages for sending replies (the chat API needs the full
  // UIMessage array). We return them separately so the thread view stays clean.
  const rawMessages = dbMessages.map((m) => m.parts);

  return Response.json({ thread, rawMessages });
}
