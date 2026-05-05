"""Curated scenario corpus for the Speak module.

Each entry is a real-shaped IT/AI/business prompt the TTS speaks aloud
to elicit a substantive verbal reply. Prompts are short (1-2 sentences)
because the user has to listen to them every take; long setups discourage
re-runs.

Categories are coarse so the picker can group them but doesn't get
overwhelming. To add a scenario, append a new entry — id strings must be
unique and stable (the frontend may persist them later as 'most-recent
scenarios').
"""
from __future__ import annotations
from typing import TypedDict


class Scenario(TypedDict):
    id: str
    category: str
    title: str
    prompt: str


SCENARIOS: list[Scenario] = [
    # ─────────────── code review ───────────────
    {
        "id": "cr-async-loop",
        "category": "code_review",
        "title": "Async loop review",
        "prompt": (
            "A teammate's pull request runs awaits inside a for loop "
            "instead of using Promise.all. Walk me through your review "
            "comment."
        ),
    },
    {
        "id": "cr-naming-bikeshed",
        "category": "code_review",
        "title": "Naming pushback",
        "prompt": (
            "A reviewer wants you to rename a function from getUser to "
            "fetchUserProfile. You disagree. How do you respond?"
        ),
    },
    {
        "id": "cr-test-coverage",
        "category": "code_review",
        "title": "Missing tests",
        "prompt": (
            "The PR adds a new payment edge case but no tests. Tell the "
            "author what you'd want covered before approving."
        ),
    },

    # ─────────────── debugging ───────────────
    {
        "id": "dbg-race-condition",
        "category": "debugging",
        "title": "Explain race conditions",
        "prompt": (
            "A junior engineer asks: what is a race condition, and why is "
            "it so hard to reproduce? Explain it to them."
        ),
    },
    {
        "id": "dbg-flaky-test",
        "category": "debugging",
        "title": "Flaky test triage",
        "prompt": (
            "A test passes locally but fails one in twenty times in CI. "
            "Talk through how you'd start investigating."
        ),
    },
    {
        "id": "dbg-prod-500",
        "category": "debugging",
        "title": "Production 500 spike",
        "prompt": (
            "Your service started returning five hundreds ten minutes ago. "
            "Walk me through your first three actions."
        ),
    },
    {
        "id": "dbg-memory-leak",
        "category": "debugging",
        "title": "Suspected memory leak",
        "prompt": (
            "A long-running Node process slowly grows from one gig to four "
            "gigs over a day. How would you confirm it's a leak and find it?"
        ),
    },

    # ─────────────── demo / pitch ───────────────
    {
        "id": "demo-feature-30s",
        "category": "demo_pitch",
        "title": "30-second feature demo",
        "prompt": (
            "Pitch the feature you most recently shipped in thirty seconds. "
            "Lead with the user problem, not the implementation."
        ),
    },
    {
        "id": "demo-sprint",
        "category": "demo_pitch",
        "title": "Sprint demo intro",
        "prompt": (
            "Open today's sprint demo. Set context for stakeholders who "
            "weren't in planning, and tell them what to watch for."
        ),
    },
    {
        "id": "demo-ai-product",
        "category": "demo_pitch",
        "title": "AI product elevator pitch",
        "prompt": (
            "An investor asks: what does your AI product do, and why now? "
            "Give a sixty-second answer."
        ),
    },

    # ─────────────── interview ───────────────
    {
        "id": "int-hardest-bug",
        "category": "interview",
        "title": "Hardest bug story",
        "prompt": (
            "An interviewer asks: tell me about the hardest bug you've ever "
            "debugged. What was it, and how did you find it?"
        ),
    },
    {
        "id": "int-disagreement",
        "category": "interview",
        "title": "Technical disagreement",
        "prompt": (
            "Tell me about a time you disagreed with a senior engineer's "
            "technical decision. What did you do?"
        ),
    },
    {
        "id": "int-system-design",
        "category": "interview",
        "title": "System design opener",
        "prompt": (
            "Design a URL shortener. Start by clarifying requirements out "
            "loud, the way you would in a real interview."
        ),
    },
    {
        "id": "int-why-leaving",
        "category": "interview",
        "title": "Why are you leaving?",
        "prompt": (
            "Why are you looking to leave your current job? Answer "
            "honestly without badmouthing your current employer."
        ),
    },

    # ─────────────── customer / comms ───────────────
    {
        "id": "cust-bad-news",
        "category": "customer",
        "title": "Delivering a missed deadline",
        "prompt": (
            "A customer expected a feature today and it'll slip by two "
            "weeks. Tell them, by phone, what happened and what's next."
        ),
    },
    {
        "id": "cust-bug-apology",
        "category": "customer",
        "title": "Production outage apology",
        "prompt": (
            "Your service was down for forty minutes during the customer's "
            "business hours. Open a follow-up call with them."
        ),
    },
    {
        "id": "cust-pricing-pushback",
        "category": "customer",
        "title": "Pricing objection",
        "prompt": (
            "A prospect says your tool is great but twice as expensive as "
            "the competitor. How do you respond?"
        ),
    },

    # ─────────────── architecture ───────────────
    {
        "id": "arch-microservices",
        "category": "architecture",
        "title": "Monolith vs microservices",
        "prompt": (
            "A new team is starting a greenfield product. They ask: should "
            "we begin with a monolith or microservices? What do you advise?"
        ),
    },
    {
        "id": "arch-rewrite-vs-refactor",
        "category": "architecture",
        "title": "Rewrite or refactor?",
        "prompt": (
            "An ageing service has eight years of crud. Make the case for "
            "refactoring instead of rewriting from scratch."
        ),
    },
    {
        "id": "arch-llm-vs-rules",
        "category": "architecture",
        "title": "LLM vs rules engine",
        "prompt": (
            "Your team is choosing between an LLM-based classifier and a "
            "rules engine for content moderation. What questions decide it?"
        ),
    },
    {
        "id": "arch-caching",
        "category": "architecture",
        "title": "When to cache",
        "prompt": (
            "Explain when a Redis cache helps and when it just hides a "
            "real performance problem you should fix instead."
        ),
    },

    # ─────────────── standup / process ───────────────
    {
        "id": "stand-blocker",
        "category": "standup",
        "title": "Standup with a blocker",
        "prompt": (
            "Give a standup update: yesterday you reviewed two pull "
            "requests, today you're stuck on a CI flake, and you need help."
        ),
    },
    {
        "id": "stand-shipped",
        "category": "standup",
        "title": "Standup after shipping",
        "prompt": (
            "Give a standup update: you shipped a feature yesterday, are "
            "watching metrics today, and have no blockers."
        ),
    },
    {
        "id": "stand-pivot",
        "category": "standup",
        "title": "Standup with a scope change",
        "prompt": (
            "Tell the team in standup that the design changed overnight "
            "and your sprint commitment needs to slip. Be matter-of-fact."
        ),
    },

    # ─────────────── mentoring ───────────────
    {
        "id": "ment-first-pr",
        "category": "mentoring",
        "title": "Welcoming a first PR",
        "prompt": (
            "A new joiner just opened their first pull request. It has a "
            "real bug. Coach them through it without crushing their morale."
        ),
    },
    {
        "id": "ment-prod-incident",
        "category": "mentoring",
        "title": "Mentoring after an incident",
        "prompt": (
            "An engineer you mentor caused an outage. The blameless "
            "postmortem is tomorrow. What do you say to them today?"
        ),
    },

    # ─────────────── AI-specific ───────────────
    {
        "id": "ai-prompt-injection",
        "category": "architecture",
        "title": "Prompt injection risk",
        "prompt": (
            "Your team is shipping an LLM agent that can read user emails. "
            "Explain prompt injection and how you'd defend against it."
        ),
    },
    {
        "id": "ai-eval-strategy",
        "category": "architecture",
        "title": "LLM eval strategy",
        "prompt": (
            "How do you evaluate an LLM-powered feature in production? "
            "Walk me through your strategy."
        ),
    },
    {
        "id": "ai-rag-vs-finetune",
        "category": "architecture",
        "title": "RAG vs fine-tuning",
        "prompt": (
            "When should you reach for retrieval-augmented generation, and "
            "when does fine-tuning the model make more sense?"
        ),
    },
    {
        "id": "ai-cost-spike",
        "category": "debugging",
        "title": "AI cost spike",
        "prompt": (
            "Your monthly OpenAI bill jumped from two hundred dollars to "
            "four thousand dollars overnight. What happens next?"
        ),
    },
]


def list_scenarios() -> list[Scenario]:
    """Returns the corpus. Stable order — the frontend may rely on this
    to keep the picker layout deterministic."""
    return list(SCENARIOS)
