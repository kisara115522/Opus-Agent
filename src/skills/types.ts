/**
 * A registerable Skill module.
 * Each Skill has a name, description, trigger keywords, and an execute method.
 */
export interface Skill {
  /** Unique skill name */
  name: string;
  /** Human-readable description of what this skill does */
  description: string;
  /** Keywords or phrases that can trigger this skill */
  triggers: string[];
  /** Execute the skill with the given context */
  execute(context: SkillContext): Promise<SkillResult>;
}

/**
 * Context passed to a Skill during execution.
 */
export interface SkillContext {
  /** The user's message */
  message: string;
  /** Current session identifier */
  sessionId: string;
  /** Source channel name (e.g. web, slack) */
  channel: string;
  /** Available tools keyed by name */
  tools: Record<string, unknown>;
}

/**
 * Result returned by a Skill after execution.
 */
export interface SkillResult {
  /** Whether the skill executed successfully */
  success: boolean;
  /** Response message to send back to the user */
  message: string;
  /** Optional structured data payload */
  data?: unknown;
}

/**
 * Registry for managing and matching Skills.
 */
export interface SkillRegistry {
  /** Register a new skill */
  register(skill: Skill): void;
  /** Find a skill whose triggers match the given message, or null */
  match(message: string): Skill | null;
  /** List all registered skills */
  list(): Skill[];
}
