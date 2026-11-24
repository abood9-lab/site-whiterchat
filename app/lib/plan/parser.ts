import type { ParsedPlanBlock, ParsedPlanQuestionsBlock, PlanQuestion } from '~/lib/stores/executionMode';
import type { EnvironmentOption, ParsedEnvironmentChoice, RuntimeEnvironment } from '~/lib/stores/runtime';
import type { ParsedSecretsBlock, SecretFieldSpec } from '~/lib/stores/secrets';

export interface PlanQuestionsParseResult {
  status: 'none' | 'streaming' | 'ready';
  beforeText: string;
  afterText: string;
  data?: ParsedPlanQuestionsBlock;
}

export interface PlanBlockParseResult {
  status: 'none' | 'streaming' | 'ready';
  beforeText: string;
  afterText: string;
  partialTitle?: string;
  partialContent?: string;
  data?: ParsedPlanBlock;
}

const QUESTIONS_OPEN = '<boltPlanQuestions>';
const QUESTIONS_CLOSE = '</boltPlanQuestions>';
const PLAN_OPEN_REGEX = /<boltPlan(?:\s+title=["']([^"']*)["'])?\s*>/i;
const PLAN_CLOSE = '</boltPlan>';

function sanitizeJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parsePlanQuestionsContent(content: string): PlanQuestionsParseResult {
  const openIdx = content.indexOf(QUESTIONS_OPEN);
  if (openIdx === -1) {
    return { status: 'none', beforeText: content, afterText: '' };
  }

  const beforeText = content.slice(0, openIdx).trim();
  const closeIdx = content.indexOf(QUESTIONS_CLOSE, openIdx + QUESTIONS_OPEN.length);

  if (closeIdx === -1) {
    return {
      status: 'streaming',
      beforeText,
      afterText: '',
    };
  }

  const rawInner = content.slice(openIdx + QUESTIONS_OPEN.length, closeIdx);
  const afterText = content.slice(closeIdx + QUESTIONS_CLOSE.length).trim();

  try {
    const cleaned = sanitizeJsonPayload(rawInner);
    const parsed = JSON.parse(cleaned) as {
      intro?: unknown;
      questions?: Array<{
        id?: unknown;
        question?: unknown;
        options?: unknown;
        multiSelect?: unknown;
      }>;
    };

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return { status: 'none', beforeText: content, afterText: '' };
    }

    const questions: PlanQuestion[] = parsed.questions
      .filter((q) => typeof q?.question === 'string' && q.question.trim().length > 0)
      .map((q, index) => ({
        id: typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `q${index + 1}`,
        question: String(q.question).trim(),
        options: Array.isArray(q.options)
          ? q.options.filter((opt): opt is string => typeof opt === 'string' && opt.trim().length > 0)
          : [],
        multiSelect: Boolean(q.multiSelect),
      }));

    if (questions.length === 0) {
      return { status: 'none', beforeText: content, afterText: '' };
    }

    return {
      status: 'ready',
      beforeText,
      afterText,
      data: {
        intro: typeof parsed.intro === 'string' ? parsed.intro.trim() : undefined,
        questions,
      },
    };
  } catch {
    return { status: 'none', beforeText: content, afterText: '' };
  }
}

export function parsePlanBlockContent(content: string): PlanBlockParseResult {
  const openMatch = PLAN_OPEN_REGEX.exec(content);
  if (!openMatch) {
    return { status: 'none', beforeText: content, afterText: '' };
  }

  const openIdx = openMatch.index;
  const openTagLength = openMatch[0].length;
  const title = (openMatch[1] || 'Implementation Plan').trim() || 'Implementation Plan';
  const beforeText = content.slice(0, openIdx).trim();

  const closeIdx = content.indexOf(PLAN_CLOSE, openIdx + openTagLength);

  if (closeIdx === -1) {
    return {
      status: 'streaming',
      beforeText,
      afterText: '',
      partialTitle: title,
      partialContent: content.slice(openIdx + openTagLength).trim(),
    };
  }

  const markdown = content.slice(openIdx + openTagLength, closeIdx).trim();
  const afterText = content.slice(closeIdx + PLAN_CLOSE.length).trim();

  return {
    status: 'ready',
    beforeText,
    afterText,
    data: {
      title,
      markdown,
    },
  };
}

export interface PlanSection {
  id: string;
  title: string;
  level: 1 | 2 | 3;
}

export function extractPlanSections(markdown: string): PlanSection[] {
  const sections: PlanSection[] = [];
  const lines = markdown.split('\n');
  let insideFence = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence) {
      continue;
    }

    const match = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (!match) {
      continue;
    }

    const level = match[1].length as 1 | 2 | 3;
    const title = match[2].replace(/[*_`]/g, '').trim();
    if (!title) {
      continue;
    }

    sections.push({
      id: `section-${sections.length + 1}`,
      title,
      level,
    });
  }

  return sections;
}

export interface EnvironmentChoiceParseResult {
  status: 'none' | 'streaming' | 'ready';
  beforeText: string;
  afterText: string;
  data?: ParsedEnvironmentChoice;
}

const ENV_CHOICE_OPEN = '<boltEnvironmentChoice>';
const ENV_CHOICE_CLOSE = '</boltEnvironmentChoice>';

function normalizeEnvId(value: unknown): RuntimeEnvironment {
  return value === 'daytona' ? 'daytona' : 'webcontainer';
}

export function parseEnvironmentChoiceContent(content: string): EnvironmentChoiceParseResult {
  const openIdx = content.indexOf(ENV_CHOICE_OPEN);
  if (openIdx === -1) {
    return { status: 'none', beforeText: content, afterText: '' };
  }

  const beforeText = content.slice(0, openIdx).trim();
  const closeIdx = content.indexOf(ENV_CHOICE_CLOSE, openIdx + ENV_CHOICE_OPEN.length);

  if (closeIdx === -1) {
    return {
      status: 'streaming',
      beforeText,
      afterText: '',
    };
  }

  const rawInner = content.slice(openIdx + ENV_CHOICE_OPEN.length, closeIdx);
  const afterText = content.slice(closeIdx + ENV_CHOICE_CLOSE.length).trim();

  try {
    const cleaned = sanitizeJsonPayload(rawInner);
    const parsed = JSON.parse(cleaned) as {
      analysisSummary?: unknown;
      recommended?: unknown;
      options?: Array<{
        id?: unknown;
        title?: unknown;
        suitability?: unknown;
        reasons?: unknown;
        limitations?: unknown;
      }>;
    };

    const recommended = normalizeEnvId(parsed.recommended);
    const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];

    const normalizedMap = new Map<RuntimeEnvironment, EnvironmentOption>();
    for (const item of rawOptions) {
      const id = normalizeEnvId(item?.id);
      normalizedMap.set(id, {
        id,
        title:
          typeof item?.title === 'string' && item.title.trim()
            ? item.title.trim()
            : id === 'daytona'
              ? 'Daytona Cloud Sandbox'
              : 'WebContainer (Browser)',
        suitability: typeof item?.suitability === 'string' ? item.suitability.trim() : '',
        reasons: Array.isArray(item?.reasons)
          ? item.reasons.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
          : [],
        limitations: Array.isArray(item?.limitations)
          ? item.limitations.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
          : [],
      });
    }

    if (!normalizedMap.has('webcontainer')) {
      normalizedMap.set('webcontainer', {
        id: 'webcontainer',
        title: 'WebContainer (Browser)',
        suitability: 'Instant browser-based Node.js & frontend runtime',
        reasons: ['Zero cold-start latency inside the browser', 'Ideal for React, Vite, TypeScript, and static/JS apps'],
        limitations: ['No pip packages, native Linux binaries, or system databases'],
      });
    }

    if (!normalizedMap.has('daytona')) {
      normalizedMap.set('daytona', {
        id: 'daytona',
        title: 'Daytona Cloud Sandbox',
        suitability: 'Full Linux cloud VM for backend, Python, and native tooling',
        reasons: ['Full Linux shell with pip, Python packages, Git, and native binaries', 'Dedicated cloud ports with live signed preview URLs'],
        limitations: ['Requires DAYTONA_API_KEY configured on the server'],
      });
    }

    const orderedOptions =
      recommended === 'daytona'
        ? [normalizedMap.get('daytona')!, normalizedMap.get('webcontainer')!]
        : [normalizedMap.get('webcontainer')!, normalizedMap.get('daytona')!];

    return {
      status: 'ready',
      beforeText,
      afterText,
      data: {
        analysisSummary:
          typeof parsed.analysisSummary === 'string' && parsed.analysisSummary.trim()
            ? parsed.analysisSummary.trim()
            : '',
        recommended,
        options: orderedOptions,
      },
    };
  } catch {
    return { status: 'none', beforeText: content, afterText: '' };
  }
}

export interface SecretsParseResult {
  status: 'none' | 'streaming' | 'ready';
  beforeText: string;
  afterText: string;
  data?: ParsedSecretsBlock;
}

const SECRETS_OPEN = '<boltSecrets>';
const SECRETS_CLOSE = '</boltSecrets>';

export function parseSecretsBlockContent(content: string): SecretsParseResult {
  const openIdx = content.indexOf(SECRETS_OPEN);
  if (openIdx === -1) {
    return { status: 'none', beforeText: content, afterText: '' };
  }

  const beforeText = content.slice(0, openIdx).trim();
  const closeIdx = content.indexOf(SECRETS_CLOSE, openIdx + SECRETS_OPEN.length);

  if (closeIdx === -1) {
    return {
      status: 'streaming',
      beforeText,
      afterText: '',
    };
  }

  const rawInner = content.slice(openIdx + SECRETS_OPEN.length, closeIdx);
  const afterText = content.slice(closeIdx + SECRETS_CLOSE.length).trim();

  try {
    const cleaned = sanitizeJsonPayload(rawInner);
    const parsed = JSON.parse(cleaned) as
      | {
          intro?: unknown;
          secrets?: Array<{
            key?: unknown;
            label?: unknown;
            description?: unknown;
            required?: unknown;
            placeholder?: unknown;
          }>;
        }
      | Array<{
          key?: unknown;
          label?: unknown;
          description?: unknown;
          required?: unknown;
          placeholder?: unknown;
        }>;

    const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.secrets) ? parsed.secrets : [];
    const intro = !Array.isArray(parsed) && typeof parsed?.intro === 'string' ? parsed.intro.trim() : undefined;

    const secrets: SecretFieldSpec[] = rawList
      .filter((item) => typeof item?.key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.key.trim()))
      .map((item) => ({
        key: String(item.key).trim(),
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined,
        description:
          typeof item.description === 'string' && item.description.trim() ? item.description.trim() : undefined,
        required: item.required === undefined ? true : Boolean(item.required),
        placeholder:
          typeof item.placeholder === 'string' && item.placeholder.trim() ? item.placeholder.trim() : undefined,
      }));

    if (secrets.length === 0) {
      return { status: 'none', beforeText: content, afterText: '' };
    }

    return {
      status: 'ready',
      beforeText,
      afterText,
      data: {
        intro,
        secrets,
      },
    };
  } catch {
    return { status: 'none', beforeText: content, afterText: '' };
  }
}

