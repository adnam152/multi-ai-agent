/**
 * Self-Learning — Phase 2C
 *
 * Brain tự rút kinh nghiệm từ:
 *  1. Lỗi tool calling (tool fail, wrong agent, timeout)
 *  2. User correction ("không phải vậy", "sai rồi", "ý tôi là...")
 *  3. Successful patterns (user satisfied)
 *
 * Lessons được lưu vào memory với flag _lesson=true và score cao hơn
 * nên Prompt Assembler luôn ưu tiên kéo vào context.
 *
 * KHÔNG thay đổi model weights — đây là behavioral learning qua context.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const memory = require('./memory');

const LESSONS_FILE = path.join(__dirname, '../data/lessons.json');
let lessons = [];

function loadLessons() {
    try {
        if (fs.existsSync(LESSONS_FILE))
            lessons = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
    } catch { lessons = []; }
}

function saveLessons() {
    try { fs.writeFileSync(LESSONS_FILE, JSON.stringify(lessons, null, 2)); } catch { }
}

// ─── Detect if user is correcting the brain ───────────────────────────────────

const CORRECTION_PATTERNS = [
    /không phải/i, /sai rồi/i, /ý tôi là/i, /không đúng/i,
    /no,?\s+i mean/i, /that'?s wrong/i, /incorrect/i,
    /thực ra/i, /actually/i, /nhưng mà/i, /you misunderstood/i,
    /hiểu nhầm/i, /không phải vậy/i
];

const SATISFACTION_PATTERNS = [
    /đúng rồi/i, /chính xác/i, /cảm ơn/i, /tuyệt/i, /ok$/i, /perfect/i,
    /exactly/i, /that'?s right/i, /good job/i, /great/i, /thanks/i
];

function detectCorrectionType(userInput) {
    if (CORRECTION_PATTERNS.some(p => p.test(userInput))) return 'correction';
    if (SATISFACTION_PATTERNS.some(p => p.test(userInput))) return 'satisfaction';
    return null;
}

// ─── Store a lesson ────────────────────────────────────────────────────────────

function storeLesson({ type, trigger, lesson, context = '' }) {
    const entry = {
        id: Date.now().toString(36),
        type,       // 'tool_error' | 'user_correction' | 'pattern' | 'routing'
        trigger,    // what caused this lesson
        lesson,     // the actual lesson text (injected into future context)
        context,    // optional context snippet
        timestamp: Date.now(),
        useCount: 0,
    };

    // Avoid duplicate lessons (same trigger)
    const dup = lessons.find(l => l.trigger === trigger);
    if (dup) {
        dup.lesson = lesson;  // update existing
        dup.timestamp = Date.now();
        saveLessons();
        logger.debug('self-learn', `Updated lesson: ${trigger.slice(0, 60)}`);
        return dup;
    }

    lessons.push(entry);
    if (lessons.length > 200) lessons.shift(); // keep last 200
    saveLessons();

    // Also inject into memory so Prompt Assembler picks it up
    memory.store('system', `[LESSON] ${lesson}`, 'brain', { _lesson: true });

    logger.info('self-learn', `New lesson (${type}): ${lesson.slice(0, 80)}`);
    return entry;
}

// ─── Learn from a tool error ──────────────────────────────────────────────────

function learnFromToolError({ toolName, args, error, userInput }) {
    let lesson = '';

    if (toolName === 'call_agent' && error?.includes('not found')) {
        lesson = `Khi gọi agent "${args?.agent_id}", agent đó không tồn tại. Hãy dùng list_agents trước để kiểm tra agent IDs.`;
    } else if (toolName === 'run_command' && error?.includes('blocked')) {
        lesson = `Lệnh "${args?.command}" bị chặn bởi whitelist. Chỉ được dùng read-only commands.`;
    } else if (error?.includes('timeout')) {
        lesson = `Tool ${toolName} bị timeout (60s) khi xử lý: "${(userInput || '').slice(0, 50)}". Cân nhắc chia nhỏ task.`;
    } else {
        lesson = `Tool ${toolName} gặp lỗi: ${(error || '').slice(0, 100)}. Args: ${JSON.stringify(args || {}).slice(0, 100)}.`;
    }

    return storeLesson({
        type: 'tool_error',
        trigger: `${toolName}:${JSON.stringify(args).slice(0, 50)}`,
        lesson,
    });
}

// ─── Learn from user correction ───────────────────────────────────────────────

function learnFromCorrection({ userCorrection, previousResponse, previousInput }) {
    const lesson = `Khi user hỏi "${(previousInput || '').slice(0, 80)}", câu trả lời "${(previousResponse || '').slice(0, 80)}" bị sai. User đã sửa: "${userCorrection.slice(0, 120)}". Hãy tránh lỗi tương tự.`;

    return storeLesson({
        type: 'user_correction',
        trigger: (previousInput || '').slice(0, 60),
        lesson,
        context: userCorrection,
    });
}

// ─── Learn successful routing pattern ─────────────────────────────────────────

function learnRoutingPattern({ userInput, agentUsed, successful }) {
    if (!successful) return;

    const keywords = userInput.toLowerCase().split(/\W+/).filter(w => w.length > 3).slice(0, 5);
    if (!keywords.length) return;

    const lesson = `Pattern: khi user hỏi về "${keywords.join(', ')}", ${agentUsed} xử lý tốt.`;

    return storeLesson({
        type: 'routing',
        trigger: keywords.join('-'),
        lesson,
    });
}

// ─── Analyze conversation after completion ────────────────────────────────────

async function analyzeConversation({ userInput, brainResponse, toolsUsed, errors }) {
    // Auto-detect correction
    const corrType = detectCorrectionType(userInput);

    if (corrType === 'correction') {
        // Get previous exchange from memory
        const hist = memory.getHistory('brain', 10);
        const prevAssistant = [...hist].reverse().find(m => m.role === 'assistant');
        const prevUser = [...hist].reverse().find(m => m.role === 'user' && m.content !== userInput);

        if (prevAssistant) {
            learnFromCorrection({
                userCorrection: userInput,
                previousResponse: prevAssistant.content,
                previousInput: prevUser?.content || '',
            });
        }
    }

    // Learn from tool errors
    if (errors?.length) {
        for (const err of errors) {
            if (err.tool) learnFromToolError(err);
        }
    }
}

// ─── Get lessons relevant to current input ────────────────────────────────────

function getRelevantLessons(userInput, limit = 3) {
    const words = new Set(userInput.toLowerCase().split(/\W+/).filter(w => w.length > 3));

    return lessons
        .map(l => {
            const lWords = l.lesson.toLowerCase().split(/\W+/).filter(w => w.length > 3);
            const overlap = lWords.filter(w => words.has(w)).length;
            return { ...l, score: overlap };
        })
        .filter(l => l.score > 0)
        .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
        .slice(0, limit)
        .map(l => l.lesson);
}

// ─── Build lessons context string (injected into system prompt) ───────────────

function buildLessonsContext(userInput) {
    const relevant = getRelevantLessons(userInput);
    if (!relevant.length) return '';
    return `\n## Bài học từ kinh nghiệm trước\n${relevant.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
}

module.exports = {
    init: loadLessons,
    storeLesson,
    learnFromToolError,
    learnFromCorrection,
    learnRoutingPattern,
    analyzeConversation,
    buildLessonsContext,
    getLessons: () => lessons,
    getLessonCount: () => lessons.length,
};