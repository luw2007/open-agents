interface ResumableStreamContext {
  createNewResumableStream: (
    _streamId: string,
    streamFactory: () => ReadableStream,
  ) => Promise<ReadableStream>;
  resumeExistingStream: (_streamId: string) => Promise<null>;
}

export const resumableStreamContext: ResumableStreamContext = {
  createNewResumableStream: async (_streamId, streamFactory) => streamFactory(),
  resumeExistingStream: async () => null,
};
