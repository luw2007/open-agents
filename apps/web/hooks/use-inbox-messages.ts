import useSWR from "swr";
import type { InboxThreadMessage } from "@/app/api/inbox/[chatId]/messages/route";

interface InboxMessagesResponse {
  thread: InboxThreadMessage[];
  rawMessages: unknown[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useInboxMessages(chatId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<InboxMessagesResponse>(
    chatId ? `/api/inbox/${chatId}/messages` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );

  return {
    thread: data?.thread ?? [],
    rawMessages: data?.rawMessages ?? [],
    loading: isLoading,
    error,
    refresh: mutate,
  };
}
