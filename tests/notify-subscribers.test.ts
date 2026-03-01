import { describe, expect, it } from "vitest";

/**
 * Pure function to test subscription matching logic.
 * Extracted from notifyMatchingSubscribers in src/lib/notify-subscribers.ts
 *
 * Matching rules (AND of non-null filters):
 * - panel_id: must match bounty panel (null = match all)
 * - difficulty_tier: must match (null = match all)
 * - min_reward: bounty reward >= subscription min (null = no minimum)
 * - tags: at least one overlap (null = match all)
 */
function matchesSubscription(
  subscription: {
    panel_id: string | null;
    difficulty_tier: string | null;
    min_reward: number | null;
    tags: string | null;
  },
  bounty: {
    panelId: string | null;
    difficultyTier: string;
    rewardAmount: number;
    tags: string[];
  }
): boolean {
  // Panel filter: if subscription has panel_id, it must match bounty panelId
  if (subscription.panel_id && subscription.panel_id !== bounty.panelId) {
    return false;
  }

  // Difficulty filter: if subscription has difficulty_tier, it must match bounty difficultyTier
  if (subscription.difficulty_tier && subscription.difficulty_tier !== bounty.difficultyTier) {
    return false;
  }

  // Min reward filter: if subscription has min_reward, bounty reward must be >= min_reward
  if (typeof subscription.min_reward === "number" && bounty.rewardAmount < subscription.min_reward) {
    return false;
  }

  // Tag filter: if subscription has tags, at least one must overlap with bounty tags
  if (subscription.tags) {
    const subscriptionTags = subscription.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);

    // If subscription has non-empty tags, require at least one overlap
    if (subscriptionTags.length > 0) {
      const bountyTagSet = new Set(bounty.tags.map((tag) => tag.toLowerCase()));
      const hasOverlap = subscriptionTags.some((tag) => bountyTagSet.has(tag));
      if (!hasOverlap) {
        return false;
      }
    }
  }

  return true;
}

describe("matchesSubscription", () => {
  describe("no filters", () => {
    it("matches any bounty when subscription has no filters", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches bounty with null panelId when subscription has no panel filter", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: null,
        difficultyTier: "moderate",
        rewardAmount: 1000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });
  });

  describe("panel filter", () => {
    it("matches when subscription panel_id equals bounty panelId", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when subscription panel_id differs from bounty panelId", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "physics",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("matches any panel when subscription panel_id is null", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "cs",
        difficultyTier: "moderate",
        rewardAmount: 2000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when subscription has panel_id and bounty has null panelId", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: null,
        difficultyTier: "moderate",
        rewardAmount: 1000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });
  });

  describe("difficulty filter", () => {
    it("matches when subscription difficulty_tier equals bounty difficultyTier", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: "research",
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when subscription difficulty_tier differs from bounty difficultyTier", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: "trivial",
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("matches any difficulty when subscription difficulty_tier is null", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "hard",
        rewardAmount: 3000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches all difficulty tiers independently", () => {
      const tiers = ["trivial", "moderate", "hard", "research"];

      for (const tier of tiers) {
        const subscription = {
          panel_id: null,
          difficulty_tier: tier,
          min_reward: null,
          tags: null,
        };

        const bounty = {
          panelId: "math",
          difficultyTier: tier,
          rewardAmount: 1000,
          tags: [],
        };

        expect(matchesSubscription(subscription, bounty)).toBe(true);
      }
    });
  });

  describe("min_reward filter", () => {
    it("matches when bounty reward equals subscription min_reward", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: 5000,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches when bounty reward exceeds subscription min_reward", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: 5000,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when bounty reward is below subscription min_reward", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: 5000,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 4999,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("matches any reward when subscription min_reward is null", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "trivial",
        rewardAmount: 100,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles zero reward", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: 0,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "trivial",
        rewardAmount: 0,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles large reward amounts", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: 1000000,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 1000001,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });
  });

  describe("tag filter", () => {
    it("matches when subscription tags overlap with bounty tags", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "number-theory,algebra",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches when subscription has single tag matching bounty tag", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "computational",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when subscription tags have no overlap with bounty tags", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "topology,geometry",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("matches any tags when subscription tags is null", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches any tags when subscription tags is empty string", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches any tags when subscription tags contains only whitespace", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "   ,  , ",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("performs case-insensitive tag matching", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "Number-Theory,ALGEBRA",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles tags with leading/trailing whitespace", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "  number-theory  ,  algebra  ",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches when bounty has empty tags array", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when subscription has tags but bounty has empty tags array", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "number-theory",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("matches multiple overlapping tags", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "number-theory,computational,algebra",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["number-theory", "computational", "geometry"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });
  });

  describe("combined filters", () => {
    it("matches when all filters match", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: "research",
        min_reward: 5000,
        tags: "number-theory,computational",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory", "algebra"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("does not match when panel filter fails", () => {
      const subscription = {
        panel_id: "physics",
        difficulty_tier: "research",
        min_reward: 5000,
        tags: "number-theory",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("does not match when difficulty filter fails", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: "trivial",
        min_reward: 5000,
        tags: "number-theory",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("does not match when min_reward filter fails", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: "research",
        min_reward: 15000,
        tags: "number-theory",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("does not match when tag filter fails", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: "research",
        min_reward: 5000,
        tags: "topology,geometry",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("does not match when multiple filters fail", () => {
      const subscription = {
        panel_id: "physics",
        difficulty_tier: "trivial",
        min_reward: 15000,
        tags: "topology",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(false);
    });

    it("matches with partial filters (panel + reward)", () => {
      const subscription = {
        panel_id: "math",
        difficulty_tier: null,
        min_reward: 5000,
        tags: null,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("matches with partial filters (difficulty + tags)", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: "research",
        min_reward: null,
        tags: "number-theory",
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 10000,
        tags: ["number-theory", "computational"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles subscription with all filters set to null", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: null,
        difficultyTier: "moderate",
        rewardAmount: 0,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles bounty with null panelId and matching subscription with null panel_id", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: "moderate",
        min_reward: null,
        tags: null,
      };

      const bounty = {
        panelId: null,
        difficultyTier: "moderate",
        rewardAmount: 1000,
        tags: [],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles very long tag lists", () => {
      const manyTags = Array.from({ length: 100 }, (_, i) => `tag-${i}`).join(",");
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: manyTags,
      };

      const bounty = {
        panelId: "math",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["tag-50"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles special characters in tags", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "c++,c#,node.js",
      };

      const bounty = {
        panelId: "cs",
        difficultyTier: "moderate",
        rewardAmount: 2000,
        tags: ["c++", "algorithms"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });

    it("handles unicode characters in tags", () => {
      const subscription = {
        panel_id: null,
        difficulty_tier: null,
        min_reward: null,
        tags: "量子力学,相对论",
      };

      const bounty = {
        panelId: "physics",
        difficultyTier: "research",
        rewardAmount: 5000,
        tags: ["量子力学", "光学"],
      };

      expect(matchesSubscription(subscription, bounty)).toBe(true);
    });
  });
});
