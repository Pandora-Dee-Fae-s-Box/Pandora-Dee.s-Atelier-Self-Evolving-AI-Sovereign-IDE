// Well-known models for SEASIDE's engines, grouped by how much memory they need, so a model the engine doesn't have
// yet can be chosen (and, where the engine can, downloaded) without hunting for names. Sizes are the download sizes
// on Hugging Face (checked 2026-11-25); "needs" is the memory to run it comfortably (unified memory on a Mac, the
// graphics card's on a PC). Only models with a public, permissive-enough licence that are widely used are listed.
// (modelCatalog.test.ts)

export type CatalogKind = "music" | "speech" | "listen" | "picture";

export type CatalogModel = {
  id: string;
  kind: CatalogKind;
  /** Download size, GB. */
  size: number;
  /** Memory to run it comfortably, GB. */
  needs: number;
  note: string;
  /** Where it comes from (for ones an engine can't download itself: where to get it). */
  link: string;
  licence?: string;
};

const hf = (id: string) => `https://huggingface.co/${id}`;

export const CATALOG: CatalogModel[] = [
  // songs: MiniMax Music 3 in MLX (the music bridge), from smallest to largest
  { id: "mlx-community/MiniMax-Music3-mxfp4", kind: "music", size: 8.9, needs: 16, note: "4-bit (mxfp4): the lightest", link: hf("mlx-community/MiniMax-Music3-mxfp4") },
  { id: "mlx-community/MiniMax-Music3-4bit", kind: "music", size: 9.2, needs: 16, note: "4-bit: the most used light one", link: hf("mlx-community/MiniMax-Music3-4bit") },
  { id: "mlx-community/MiniMax-Music3-6bit", kind: "music", size: 11.7, needs: 24, note: "6-bit: between light and full detail", link: hf("mlx-community/MiniMax-Music3-6bit") },
  { id: "mlx-community/MiniMax-Music3-8bit", kind: "music", size: 14.2, needs: 24, note: "8-bit: close to the original, the most downloaded", link: hf("mlx-community/MiniMax-Music3-8bit") },
  { id: "mlx-community/MiniMax-Music3-mxfp8", kind: "music", size: 13.9, needs: 24, note: "8-bit (mxfp8): close to the original", link: hf("mlx-community/MiniMax-Music3-mxfp8") },
  { id: "mlx-community/MiniMax-Music3-bf16", kind: "music", size: 28.5, needs: 48, note: "unquantized: the original's full detail", link: hf("mlx-community/MiniMax-Music3-bf16") },
  // voices (MLX Audio's server): downloaded the first time they're used
  { id: "mlx-community/Kokoro-82M-bf16", kind: "speech", size: 0.4, needs: 4, note: "Kokoro: quick, natural, about 50 voices", link: hf("mlx-community/Kokoro-82M-bf16"), licence: "Apache-2.0" },
  { id: "mlx-community/chatterbox-fp16", kind: "speech", size: 2.6, needs: 8, note: "Chatterbox: expressive, can copy a voice from a sample", link: hf("mlx-community/chatterbox-fp16"), licence: "Apache-2.0" },
  { id: "mlx-community/csm-1b", kind: "speech", size: 6.2, needs: 12, note: "Sesame CSM: conversational", link: hf("mlx-community/csm-1b"), licence: "Apache-2.0" },
  { id: "mlx-community/Dia-1.6B", kind: "speech", size: 6.4, needs: 12, note: "Dia: dialogue, two speakers, laughs and sighs", link: hf("mlx-community/Dia-1.6B"), licence: "Apache-2.0" },
  { id: "mlx-community/orpheus-3b-0.1-ft-bf16", kind: "speech", size: 6.6, needs: 12, note: "Orpheus: very lifelike, emotion tags", link: hf("mlx-community/orpheus-3b-0.1-ft-bf16"), licence: "Apache-2.0" },
  // listening (speech to text)
  { id: "mlx-community/whisper-small-mlx", kind: "listen", size: 0.5, needs: 4, note: "Whisper small: quick, good enough for most", link: hf("mlx-community/whisper-small-mlx"), licence: "MIT" },
  { id: "mlx-community/whisper-large-v3-turbo", kind: "listen", size: 1.6, needs: 6, note: "Whisper large v3 turbo: accurate and still quick, many languages", link: hf("mlx-community/whisper-large-v3-turbo"), licence: "MIT" },
  { id: "mlx-community/parakeet-tdt-0.6b-v3", kind: "listen", size: 2.5, needs: 6, note: "Parakeet v3: very fast and accurate, European languages", link: hf("mlx-community/parakeet-tdt-0.6b-v3"), licence: "CC-BY-4.0" },
  // pictures (ComfyUI checkpoints, or Draw Things' own model list): put the file in ComfyUI's models/checkpoints
  { id: "v1-5-pruned-emaonly.safetensors", kind: "picture", size: 4.3, needs: 4, note: "Stable Diffusion 1.5: small, quick, huge choice of styles", link: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/blob/main/v1-5-pruned-emaonly.safetensors", licence: "CreativeML OpenRAIL-M" },
  { id: "sd_xl_base_1.0.safetensors", kind: "picture", size: 6.9, needs: 8, note: "SDXL 1.0: sharp 1024-pixel pictures", link: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/sd_xl_base_1.0.safetensors", licence: "CreativeML OpenRAIL++-M" },
  { id: "flux1-schnell-fp8.safetensors", kind: "picture", size: 17.2, needs: 16, note: "FLUX.1 schnell (fp8): excellent quality in 4 steps", link: "https://huggingface.co/Comfy-Org/Flux-1-Schnell/blob/main/flux1-schnell-fp8.safetensors", licence: "Apache-2.0" },
];

/** The memory groups models are shown in. */
export const TIERS: { upTo: number; label: string }[] = [
  { upTo: 8, label: "Light: 8 GB or less" },
  { upTo: 16, label: "Up to 16 GB" },
  { upTo: 32, label: "Up to 32 GB" },
  { upTo: Infinity, label: "48 GB and more" },
];

export const tierOf = (m: CatalogModel) => TIERS.find((t) => m.needs <= t.upTo)!;

/** Models of this kind in their memory groups, lightest first; with `memory` known, each says whether it fits. */
export function catalogFor(kind: CatalogKind, memory?: number): { label: string; models: (CatalogModel & { fits: boolean | null })[] }[] {
  const list = CATALOG.filter((m) => m.kind === kind).sort((a, b) => a.needs - b.needs || a.size - b.size);
  return TIERS.map((t) => ({
    label: t.label,
    models: list.filter((m) => tierOf(m) === t).map((m) => ({ ...m, fits: memory ? m.needs <= memory : null })),
  })).filter((g) => g.models.length);
}
