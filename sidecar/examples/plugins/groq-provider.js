/**
 * Example plugin: groq-provider.
 *
 * Registers Groq as a new direct LLM provider so users can pick it from
 * the chip dropdown without a new Ollopa build. The user must have set the
 * GROQ_API_KEY in their environment before launching the sidecar.
 *
 * In a real install, the sidecar's direct-provider router would need to
 * resolve a key from SecretStorage for this provider. For the MVP, we read
 * GROQ_API_KEY from the sidecar's process env.
 */
module.exports = {
  name: 'groq-provider',
  version: '0.1.0',
  providers: [
    {
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      enabled: true,
      defaultModel: 'llama-3.1-70b-versatile',
    },
  ],
};
