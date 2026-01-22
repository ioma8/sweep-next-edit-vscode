import * as fs from "node:fs";
import { buildPrompt } from "../core/prompt";
import type { NextEditPredictor, NextEditRequest } from "./nextEditPredictor";
import type { Logger } from "../logging";
import { createNoopLogger } from "../logging";
import { dynamicImport } from "../utils/dynamicImport";
import { sleep } from "../utils/sleep";

export type LlamaCppPredictorConfig = {
  modelPath: string;
  maxTokens: number;
  contextSize: number;
};

export class LlamaCppNextEditPredictor implements NextEditPredictor {
  private initPromise: Promise<void> | undefined;
  private llamaModule: any | undefined;
  private context: any | undefined;

  private readonly logger: Logger;

  constructor(getConfig: () => LlamaCppPredictorConfig, logger?: Logger) {
    this.getConfig = getConfig;
    this.logger = logger ?? createNoopLogger();
  }

  private readonly getConfig: () => LlamaCppPredictorConfig;

  private async initIfNeeded() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const { modelPath, contextSize } = this.getConfig();
      if (!modelPath) {
        this.logger.warn("Model path is empty; predictor disabled.");
        return;
      }
      if (!fs.existsSync(modelPath)) {
        this.logger.error(`Model file not found at: ${modelPath}`);
        return;
      }

      try {
        this.logger.info(`Loading model: ${modelPath}`);
        this.llamaModule = await dynamicImport<any>("node-llama-cpp");
        const llama = await this.llamaModule.getLlama({
          build: "auto",
          logLevel: this.llamaModule.LlamaLogLevel?.warn ?? "warn",
          logger: (_level: any, message: string) => this.logger.info(`[llama] ${message}`)
        });
        const model = await llama.loadModel({ modelPath, gpuLayers: "auto" });
        this.context = await model.createContext({ contextSize, sequences: 2 });
        this.logger.info("Model loaded and context created.");
      } catch (err) {
        this.logger.error("Failed to initialize llama.cpp backend/model.", err);
      }
    })();

    return this.initPromise;
  }

  async predictNextEdit(request: NextEditRequest, signal: AbortSignal): Promise<string> {
    await this.initIfNeeded();
    if (!this.context || !this.llamaModule) return request.currentWindow;

    const { maxTokens } = this.getConfig();
    const prompt = buildPrompt({
      filePath: request.filePath,
      originalContent: request.originalWindow,
      currentContent: request.currentWindow,
      contextFiles: request.contextFiles,
      recentDiffs: request.recentDiffs
    });

    this.logger.info(`Prompt is: ${prompt}`);

    try {
      const start = Date.now();
      this.logger.info(
        `Starting inference (promptChars=${prompt.length}, currentWindowChars=${request.currentWindow.length}, maxTokens=${maxTokens})`
      );
      while (this.context.sequencesLeft === 0) {
        if (signal.aborted) throw signal.reason ?? new Error("Aborted");
        await sleep(10, signal);
      }
      const sequence = this.context.getSequence();
      const completion = new this.llamaModule.LlamaCompletion({ contextSequence: sequence, autoDisposeSequence: true });

      try {
        const response = await completion.generateCompletion(prompt, {
          maxTokens,
          temperature: 0,
          stopOnAbortSignal: true,
          signal,
          customStopTriggers: ["<|file_sep|>", "</s>"]
        });

        this.logger.info(`Inference done in ${Date.now() - start}ms (responseChars=${response.length})`);
        this.logger.info(`Response: ${response}`);
        return response;
      } finally {
        completion.dispose({ disposeSequence: true });
      }
    } catch (err) {
      const name = (err as any)?.name;
      if (name === "AbortError" || signal.aborted) {
        this.logger.info("Inference aborted.");
      } else {
        this.logger.error("Inference failed.", err);
      }
      return request.currentWindow;
    }
  }
}
