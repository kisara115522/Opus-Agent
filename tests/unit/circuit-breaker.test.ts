/**
 * Unit tests for CircuitBreaker guard
 *
 * Covers: failure counting per tool, threshold tripping, reset on success,
 * failure detection (JSON parsing + keyword matching), limit exceeded response format.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../../src/agents/guards/circuit-breaker.js';
import type { CircuitBreakerErrorPayload } from '../../src/agents/guards/circuit-breaker.js';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  describe('constructor', () => {
    it('should use default threshold of 3', () => {
      const cb = new CircuitBreaker();
      expect(cb.getFailureCount('any-tool')).toBe(0);
      // Should not trip at 2 failures
      cb.processResult('tool', '{"success":false}');
      cb.processResult('tool', '{"success":false}');
      expect(cb.isTripped('tool')).toBe(false);
      // Should trip at 3
      cb.processResult('tool', '{"success":false}');
      expect(cb.isTripped('tool')).toBe(true);
    });

    it('should accept custom threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.processResult('tool', '{"success":false}');
      expect(cb.isTripped('tool')).toBe(false);
      cb.processResult('tool', '{"success":false}');
      expect(cb.isTripped('tool')).toBe(true);
    });

    it('should throw on invalid threshold', () => {
      expect(() => new CircuitBreaker({ failureThreshold: 0 })).toThrow(
        'failureThreshold must be > 0',
      );
      expect(() => new CircuitBreaker({ failureThreshold: -1 })).toThrow(
        'failureThreshold must be > 0',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Failure detection
  // -------------------------------------------------------------------------

  describe('isFailureResult', () => {
    let cb: CircuitBreaker;

    beforeEach(() => {
      cb = new CircuitBreaker();
    });

    it('should detect null as failure', () => {
      expect(cb.isFailureResult(null)).toBe(true);
    });

    it('should detect undefined as failure', () => {
      expect(cb.isFailureResult(undefined)).toBe(true);
    });

    it('should detect empty string as failure', () => {
      expect(cb.isFailureResult('')).toBe(true);
    });

    it('should detect whitespace-only string as failure', () => {
      expect(cb.isFailureResult('   ')).toBe(true);
    });

    it('should detect JSON with success:false', () => {
      expect(cb.isFailureResult('{"success":false}')).toBe(true);
      expect(
        cb.isFailureResult('{"success":false,"message":"oops"}'),
      ).toBe(true);
    });

    it('should not flag JSON with success:true', () => {
      expect(cb.isFailureResult('{"success":true}')).toBe(false);
      expect(
        cb.isFailureResult('{"success":true,"data":"ok"}'),
      ).toBe(false);
    });

    it('should detect JSON with status:error', () => {
      expect(cb.isFailureResult('{"status":"error"}')).toBe(true);
    });

    it('should detect JSON with status:failed', () => {
      expect(cb.isFailureResult('{"status":"failed"}')).toBe(true);
    });

    it('should detect JSON with status:fail', () => {
      expect(cb.isFailureResult('{"status":"fail"}')).toBe(true);
    });

    it('should not flag JSON with status:success', () => {
      expect(cb.isFailureResult('{"status":"success"}')).toBe(false);
    });

    it('should detect keyword: timeout', () => {
      expect(cb.isFailureResult('Request timeout after 30s')).toBe(true);
    });

    it('should detect keyword: connection refused', () => {
      expect(cb.isFailureResult('Error: connection refused')).toBe(true);
    });

    it('should detect keyword: tool failed', () => {
      expect(cb.isFailureResult('The tool failed to execute')).toBe(true);
    });

    it('should detect keyword: 查询失败', () => {
      expect(cb.isFailureResult('查询失败，请稍后重试')).toBe(true);
    });

    it('should detect keyword: 连接失败', () => {
      expect(cb.isFailureResult('连接失败')).toBe(true);
    });

    it('should detect keyword: 尚未实现', () => {
      expect(cb.isFailureResult('该功能尚未实现')).toBe(true);
    });

    it('should be case-insensitive for keywords', () => {
      expect(cb.isFailureResult('TIMEOUT occurred')).toBe(true);
      expect(cb.isFailureResult('Connection Refused')).toBe(true);
    });

    it('should not flag normal success text', () => {
      expect(cb.isFailureResult('Temperature is 72F')).toBe(false);
      expect(
        cb.isFailureResult('{"data":"results","count":5}'),
      ).toBe(false);
    });

    it('should handle non-JSON text without keywords as success', () => {
      expect(cb.isFailureResult('Here is your answer')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Failure counting per tool
  // -------------------------------------------------------------------------

  describe('getFailureCount', () => {
    it('should track failures independently per tool', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      cb.processResult('toolA', '{"success":false}');
      cb.processResult('toolA', '{"success":false}');
      cb.processResult('toolB', '{"success":false}');

      expect(cb.getFailureCount('toolA')).toBe(2);
      expect(cb.getFailureCount('toolB')).toBe(1);
      expect(cb.getFailureCount('toolC')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Threshold tripping
  // -------------------------------------------------------------------------

  describe('isTripped', () => {
    it('should trip after reaching threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });

      expect(cb.isTripped('tool')).toBe(false);

      cb.processResult('tool', '{"success":false}');
      expect(cb.isTripped('tool')).toBe(false);

      cb.processResult('tool', '{"success":false}');
      expect(cb.isTripped('tool')).toBe(true);
    });

    it('should not trip for different tools', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });

      cb.processResult('toolA', '{"success":false}');
      cb.processResult('toolA', '{"success":false}');

      expect(cb.isTripped('toolA')).toBe(true);
      expect(cb.isTripped('toolB')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Reset on success
  // -------------------------------------------------------------------------

  describe('reset on success', () => {
    it('should reset failure count on successful result', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });

      cb.processResult('tool', '{"success":false}');
      cb.processResult('tool', '{"success":false}');
      expect(cb.getFailureCount('tool')).toBe(2);

      // Success should reset
      cb.processResult('tool', '{"success":true,"data":"ok"}');
      expect(cb.getFailureCount('tool')).toBe(0);
    });

    it('should allow re-failing after reset', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });

      cb.processResult('tool', '{"success":false}');
      cb.processResult('tool', '{"success":true}');
      expect(cb.getFailureCount('tool')).toBe(0);
      expect(cb.isTripped('tool')).toBe(false);

      // Can fail again from scratch
      cb.processResult('tool', '{"success":false}');
      expect(cb.getFailureCount('tool')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // processResult behavior
  // -------------------------------------------------------------------------

  describe('processResult', () => {
    it('should return allowed:true on success', () => {
      const cb = new CircuitBreaker();
      const result = cb.processResult('tool', '{"success":true}');
      expect(result.allowed).toBe(true);
      expect(result.payload).toBeUndefined();
    });

    it('should return allowed:true with failureCount on failure (below threshold)', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const result = cb.processResult('tool', '{"success":false}');
      expect(result.allowed).toBe(true);
      expect(result.failureCount).toBe(1);
    });

    it('should return allowed:false with payload when threshold is reached', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.processResult('tool', '{"success":false}');
      const result = cb.processResult('tool', '{"success":false}');

      expect(result.allowed).toBe(false);
      expect(result.payload).toBeDefined();
      expect(result.payload!.code).toBe('TOOL_RETRY_LIMIT_EXCEEDED');
    });

    it('should short-circuit when already tripped', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.processResult('tool', '{"success":false}');

      // Should short-circuit without processing
      const result = cb.processResult('tool', '{"success":true}');
      expect(result.allowed).toBe(false);
      expect(result.payload!.code).toBe('TOOL_RETRY_LIMIT_EXCEEDED');
    });
  });

  // -------------------------------------------------------------------------
  // processException behavior
  // -------------------------------------------------------------------------

  describe('processException', () => {
    it('should increment failure count on exception', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const result = cb.processException('tool', 'connection timeout');

      expect(result.allowed).toBe(true);
      expect(result.failureCount).toBe(1);
      expect(cb.getFailureCount('tool')).toBe(1);
    });

    it('should trip on exception reaching threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.processException('tool', 'error 1');
      const result = cb.processException('tool', 'error 2');

      expect(result.allowed).toBe(false);
      expect(result.payload!.code).toBe('TOOL_RETRY_LIMIT_EXCEEDED');
    });

    it('should return TOOL_CALL_FAILED payload for non-tripping exceptions', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const result = cb.processException('tool', 'connection refused');

      expect(result.allowed).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.code).toBe('TOOL_CALL_FAILED');
      expect(result.payload!.message).toBe('connection refused');
    });

    it('should use default message for null error', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const result = cb.processException('tool', null);

      expect(result.payload!.message).toBe('Tool failed');
    });
  });

  // -------------------------------------------------------------------------
  // Limit exceeded response format
  // -------------------------------------------------------------------------

  describe('limit exceeded response format', () => {
    it('should include all required fields', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 2,
        limitMessage: 'Custom limit message',
      });
      cb.processResult('myTool', '{"success":false}');
      const result = cb.processResult('myTool', '{"success":false}');

      const payload = result.payload as CircuitBreakerErrorPayload;
      expect(payload.success).toBe(false);
      expect(payload.status).toBe('error');
      expect(payload.code).toBe('TOOL_RETRY_LIMIT_EXCEEDED');
      expect(payload.tool).toBe('myTool');
      expect(payload.failureCount).toBe(2);
      expect(payload.threshold).toBe(2);
      expect(payload.message).toBe('Custom limit message');
    });

    it('should use default message when not configured', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.processResult('tool', '{"success":false}');

      const payload = cb.processResult('tool', '').payload!;
      expect(payload.message).toContain('达到重试上限');
    });

    it('should be valid JSON when serialized', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.processResult('tool', '{"success":false}');

      const result = cb.processResult('tool', '');
      const serialized = JSON.stringify(result.payload);
      const parsed = JSON.parse(serialized) as CircuitBreakerErrorPayload;

      expect(parsed.success).toBe(false);
      expect(parsed.code).toBe('TOOL_RETRY_LIMIT_EXCEEDED');
    });
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all failure counters', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });

      cb.processResult('toolA', '{"success":false}');
      cb.processResult('toolA', '{"success":false}');
      cb.processResult('toolB', '{"success":false}');

      cb.reset();

      expect(cb.getFailureCount('toolA')).toBe(0);
      expect(cb.getFailureCount('toolB')).toBe(0);
      expect(cb.isTripped('toolA')).toBe(false);
      expect(cb.isTripped('toolB')).toBe(false);
    });
  });
});
