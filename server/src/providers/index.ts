export interface VoiceProvider {
  generate({ voiceId, text }: { voiceId: string; text: string }): Promise<Buffer>;
}
