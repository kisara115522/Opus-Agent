import type { Skill, SkillRegistry } from './types.js';

/**
 * Default SkillRegistry implementation.
 * Matches messages against registered skill trigger keywords.
 */
export class DefaultSkillRegistry implements SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  /** Register a skill. Overwrites any existing skill with the same name. */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Find a skill whose triggers match the given message.
   * Returns the first matching skill, or null if none match.
   * Matching is case-insensitive substring check.
   */
  match(message: string): Skill | null {
    const lowerMessage = message.toLowerCase();
    for (const skill of this.skills.values()) {
      const matched = skill.triggers.some((trigger) =>
        lowerMessage.includes(trigger.toLowerCase()),
      );
      if (matched) {
        return skill;
      }
    }
    return null;
  }

  /** List all registered skills. */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }
}
