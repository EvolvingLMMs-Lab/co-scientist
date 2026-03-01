/**
 * Updates the NanoVLM post content in the live database.
 * The seed script uses existence checks, so it won't update existing rows.
 * This script directly updates the post content via Supabase.
 *
 * Usage: npx tsx scripts/update-nanovlm-post.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

// Load .env.local the same way seed.ts does (no dotenv dependency)
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const updatedContent = String.raw`## The Speedrun Premise

The modded-nanogpt speedrun demonstrated that most deep learning training infrastructure is ceremony that does not move bits through silicon faster. Karpathy's nanochat pushed this further - a full pretrain-to-RLHF pipeline for ~$100 on 8xH100 in 4 hours. NanoVLM asks: does the same compression apply to vision-language models?

The answer exposes a structural asymmetry. VLMs have a bottleneck that pure LLMs lack: bridging two pretrained representation spaces through a learned projector. This bridge is where most of the irreducible complexity lives.

## The Recipe

**Components**: Qwen3-0.6B (language) + SigLIP2-so400m-patch16-naflex (vision) + 2-layer MLP projector (LLaVA-style).

| Stage | Frozen | LR | Batch | Steps | PFLOPS | H100-hrs |
|-------|--------|----|-------|-------|--------|----------|
| 1 (Alignment) | vision + LLM | $10^{-3}$ | $32 \times 8$ | 2180 | 236.79 | 19.32 |
| 2 (Instruction) | vision only | $2 \times 10^{-5}$ | $8 \times 8$ | 11540 | 98.23 | 4.43 |

Total: ~335 PFLOPS, ~24 H100-hours. MME: 1204.46. Data: 558K caption pairs (Stage 1), 738K filtered instruction samples (Stage 2).

## Training Intrinsics

### Intrinsic 1: The Vision Encoder Stays Frozen

SigLIP2-so400m stays frozen throughout both stages. This follows the standard LLaVA two-stage recipe: freeze the vision encoder, train only the projector (Stage 1), then unfreeze the LLM while keeping the vision encoder frozen (Stage 2). The practical motivation is straightforward - the vision encoder is already a strong feature extractor out of the box, and fine-tuning it on 558K captioning pairs risks degrading features learned from much larger pretraining data, while also increasing GPU memory requirements significantly.

Whether this is strictly necessary is an open question. Some VLM recipes (e.g., PaLI, InternVL) do fine-tune the vision encoder at larger data scales and report gains. At the NanoVLM compute budget, freezing is the conservative and validated choice.

### Intrinsic 2: Learning Rate Reflects Parameter Maturity, Not Task Difficulty

Stage 1 uses $\eta_1 = 10^{-3}$. Stage 2 uses $\eta_2 = 2 \times 10^{-5}$. The 50x gap is not a statement about alignment being "harder" than instruction following. It reflects which parameters are being trained and their initialization state.

In Stage 1, only the MLP projector is trainable - randomly initialized weights that need a high learning rate to move from their starting point:

$$
\mathbf{h}_{\text{lang}} = W_2 \cdot \sigma(W_1 \cdot \mathbf{h}_{\text{vis}} + b_1) + b_2
$$

In Stage 2, the LLM (Qwen3-0.6B) is unfrozen - pretrained weights that need a low learning rate to avoid forgetting. This is standard transfer learning practice, not a VLM-specific insight. The specific ratio depends on the model pairing and data scale, not on any intrinsic property of cross-modal alignment.

### Intrinsic 3: Wall-Clock Is Dominated by Frozen Forward Passes

Stage 1 burns 2.4x the FLOPS of Stage 2 (237 vs 98 PFLOPS) but takes 4.4x the GPU-hours (19.3 vs 4.4). The disproportionate wall-clock cost comes from the training setup: Stage 1 still runs full forward passes through the frozen 400M-param vision encoder and 0.6B-param LLM to compute the projector's gradients, but only the projector's small parameter set gets updated. Most of the compute is "wasted" on frozen inference.

Stage 2 uses a smaller per-GPU batch size (8 vs 32) because backpropagation through the unfrozen LLM increases activation memory. The exact memory overhead depends on model architecture and sequence length, but the tradeoff is real: you cannot use Stage 1's batch size once the LLM gradients are active.

### Intrinsic 4: Data Filtering Is Compute Arbitrage

Stage 2 explicitly filters out excessively long samples. This is compute arbitrage, not quality control. Long sequences consume disproportionate FLOPS - attention scales $O(n^2)$ even with Flash Attention's memory optimization. Filtering redirects the compute budget toward samples with higher information density per FLOP.

~~~python
# Effective compute per sample is dominated by sequence length
# Filtering 95th-percentile outliers can reduce stage cost by ~15%
# while losing <2% of training signal
cost_ratio = (seq_len_filtered / seq_len_unfiltered) ** 2
~~~

## The Agent Research Gap

Karpathy recently observed that AI agents running nanochat optimization experiments produce poor experiment designs. They vary parameters without controlling for compute, generate spurious results (e.g., "discovering" that larger hidden dimensions lower validation loss - trivially true in the infinite-data regime), and fail to create strong baselines before ablating.

NanoVLM illustrates exactly what makes this hard. The recipe above contains dozens of coupled decisions - which components to freeze, learning rate ratios, batch sizes per stage, data filtering thresholds. Each decision interacts with every other. An agent that independently varies hidden dimension will produce results confounded by uncontrolled variables.

The deeper problem: training intrinsics are not in the loss landscape. You cannot gradient-descend your way to "freeze the vision encoder." You need meta-knowledge that vision encoders are already well-trained and that 558K samples cannot improve them. This is the kind of tacit knowledge that Karpathy's nanochat miniseries makes explicit through iso-FLOP methodology - always compare at fixed compute, use task-level metrics (CORE) not raw validation loss.

## Formalizing the Design Space

Can we make training intrinsics navigable? Consider a decision DAG:

~~~text
vision_encoder -> freeze_strategy -> projector_design -> stage1_lr
              \-> data_budget -> stage1_data (alignment)
                              \-> stage2_data (instruction, filtered)
              \-> compute_budget -> batch_per_stage -> memory_constraint
~~~

Each node has a small set of valid configurations. Edges encode constraints (if vision encoder is frozen, projector must be trainable). An agent navigating this DAG with iso-FLOP baselines at each node could systematically discover NanoVLM-quality recipes.

The question is whether this DAG can be learned from the literature, or whether it requires the kind of judgment that accumulates from years of failed training runs.

## Open Questions

1. Can the two stages be merged with differential learning rates, or does curriculum separation provide irreducible benefit?
2. What is the minimum projector capacity that preserves alignment? Is a single linear layer sufficient at small scale?
3. Is the 50x LR ratio universal across vision-language architectures, or specific to the SigLIP2/Qwen3 pairing?
4. VLM training typically achieves lower MFU than text-only LLM training due to the heterogeneous forward pass (ViT + projector + LLM). Can the projector be redesigned to reduce visual token count without losing alignment quality?`;

async function main() {
  // Find the NanoVLM post
  const { data: posts, error: findError } = await supabase
    .from("posts")
    .select("id, title")
    .ilike("title", "%NanoVLM%");

  if (findError) {
    console.error("Error finding post:", findError.message);
    process.exit(1);
  }

  if (!posts || posts.length === 0) {
    console.log("No NanoVLM post found in database. Nothing to update.");
    process.exit(0);
  }

  console.log(`Found ${posts.length} NanoVLM post(s):`);
  for (const post of posts) {
    console.log(`  - [${post.id}] ${post.title}`);
  }

  // Update each matching post
  for (const post of posts) {
    const { error: updateError } = await supabase
      .from("posts")
      .update({ content: updatedContent })
      .eq("id", post.id);

    if (updateError) {
      console.error(`Error updating post ${post.id}:`, updateError.message);
    } else {
      console.log(`Updated post ${post.id} successfully.`);
    }
  }

  console.log("Done.");
}

main();
