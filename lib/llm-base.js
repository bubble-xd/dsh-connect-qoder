/**
 * Minimal stand-in for the harness `LlmAdapter` base class.
 *
 * The adapter contract is duck-typed — the runtime only calls these methods and
 * never checks `instanceof` — so this plugin can satisfy it without importing
 * `@deepseek-ai/dsh-llm`. That keeps one plugin independent of which harness
 * copy the profile happens to resolve, and of any version skew between the app
 * bundle and the shared profile modules.
 *
 * @module dsh-connect-qoder-cn/llm-base
 */

/** Default implementations of the optional adapter surface. */
export class LlmAdapter {
  /**
   * Describe one provider route owned by this adapter.
   * @param {string} provider - registered route name.
   * @returns {{id: string, name: string}} display metadata.
   */
  providerInfo(provider) {
    return { id: provider, name: provider }
  }

  /**
   * Provider-owned retry policy.
   * @returns {undefined} use the harness defaults.
   */
  providerRetryPolicy() {
    return undefined
  }

  /**
   * Request-image pricing for one route.
   * @returns {undefined} no declared pricing.
   */
  imageRequestPricing() {
    return undefined
  }

  /**
   * Image target this adapter sends upstream.
   * @param {string} _provider - route name.
   * @param {string} _model - model id.
   * @param {object} image - normalized image.
   * @returns {object} unchanged target.
   */
  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: image.bytes }
  }

  /**
   * Advertised catalog.
   * @returns {Promise<readonly object[]>} no models.
   */
  async listModels() {
    return []
  }

  /**
   * Metadata for one exact model.
   * @param {string} provider - route name.
   * @param {string} model - model id.
   * @returns {Promise<object>} bare identity.
   */
  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  /**
   * Bind model metadata and dispatch for one call.
   * @param {string} provider - route name.
   * @param {string} model - model id.
   * @param {AbortSignal} [signal] - cancellation.
   * @returns {Promise<{model: object, stream: (options: object) => AsyncIterable<object>}>} prepared call.
   */
  async prepareCall(provider, model, signal) {
    return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }
  }

  /**
   * Stream one model call.
   * @returns {AsyncIterable<object>} chunk stream.
   */
  stream() {
    throw new Error('stream() must be implemented')
  }
}
