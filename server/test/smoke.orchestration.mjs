// Phase 8 orchestration-quality unit checks. These exercise the pure reasoning /
// conversation-state modules directly (no HTTP, no DB, no API key), asserting the
// qualities Phase 8 is about: persona differentiation, agent-aware conversation
// context, de-boilerplated turns, and richer synthesis structure. Run: part of
// `npm test`, or standalone `node server/test/smoke.orchestration.mjs`.
import assert from 'node:assert/strict';
import { ConversationState } from '../src/orchestration/ConversationState.js';
import { polishArtifact, polishUtterance } from '../src/orchestration/output.js';
import * as engine from '../src/reasoning/engine.js';

let passed = 0;
function step(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A couple of deliberately distinct personas on the same topic.
const analyst = {
  id: 'emp_a', name: 'Ada Lin', roleTitle: '資料科學家',
  expertise: ['統計', '實驗設計'], personality: '嚴謹且以證據為本',
  communicationStyle: '以數字為先', objectives: '用數據支撐每個決策',
};
const designer = {
  id: 'emp_b', name: 'Bo Chen', roleTitle: '產品設計師',
  expertise: ['UI/UX', '使用者研究'], personality: '重視同理與體驗',
  communicationStyle: '以使用者故事與範例溝通', objectives: '守住使用者體驗',
};
const topic = '新版結帳流程';

try {
  step('ConversationState.contextFor separates own vs others and names the previous speaker', () => {
    const convo = new ConversationState({ topic });
    assert.equal(convo.contextFor('Ada Lin').isFirstOverall, true, 'empty → first overall');
    convo.add({ round: 1, speaker: 'Ada Lin', role: '資料科學家', text: '先定義轉換率目標。' });
    convo.add({ round: 1, speaker: 'Bo Chen', role: '產品設計師', text: '別忘了行動裝置的體驗。' });

    const view = convo.contextFor('Ada Lin');
    assert.equal(view.isFirstOverall, false);
    assert.ok(view.previousSpeaker && view.previousSpeaker.name === 'Bo Chen', 'previous other speaker is Bo');
    assert.equal(view.myLastPoint, '先定義轉換率目標。', 'remembers own last point');
    assert.ok(view.othersDigest.includes('Bo Chen') && !view.othersDigest.includes('先定義轉換率'),
      'othersDigest excludes my own turn');
    assert.deepEqual(view.spokenSoFar, ['Bo Chen'], 'spokenSoFar excludes self');
  });

  step('engine.speak differentiates two personas on the same opening', () => {
    const a = engine.speak(analyst, topic, 0, [], []);
    const b = engine.speak(designer, topic, 0, [], []);
    assert.ok(a.length > 20 && b.length > 20, 'both produce substantive openings');
    assert.notEqual(a, b, 'different employees do not produce identical text');
    // Their expertise focus should surface in their own words.
    assert.ok(a.includes('統計') || a.includes(analyst.expertise[0]), 'analyst speaks to their focus');
    assert.ok(b.includes('UI/UX') || b.includes(designer.expertise[0]), 'designer speaks to their focus');
  });

  step('offline opening lines avoid collapsing into one shared template', () => {
    const third = {
      id: 'emp_c', name: 'Mina Hsu', roleTitle: '後端工程師',
      expertise: ['可靠性', 'API'], personality: '有系統且重視風險',
      communicationStyle: '精確且結構化', objectives: '避免系統在高峰期失手',
    };
    const openings = [analyst, designer, third].map((emp) => engine.speak(emp, topic, 0, [], []));
    const starters = openings.map((t) => t.slice(0, 12));
    assert.equal(new Set(starters).size, 3, 'three people start differently');
    assert.ok(openings.every((t) => !t.includes(`「${topic}」真正的槓桿在`)), 'legacy shared opening removed');
    assert.ok(openings.every((t) => !t.includes('我最怕的是') && !t.includes('先把限制條件攤開，再談做法')), 'shared skeleton phrases removed');
  });

  step('engine.speak avoids the banned boilerplate openers', () => {
    for (const emp of [analyst, designer]) {
      for (let r = 0; r < 3; r++) {
        const t = engine.speak(emp, topic, r, ['Ada Lin', 'Bo Chen'], []);
        assert.ok(!t.includes('從我的角度來看'), `no formulaic opener (r${r})`);
        assert.ok(!/^作為一名/.test(t), `no "作為一名…" opener (r${r})`);
        assert.ok(!/^總的來說/.test(t), `no "總的來說" opener (r${r})`);
      }
    }
  });

  step('output polish removes boilerplate opener and repairs dangling sentence tails', () => {
    const cleaned = polishUtterance('從我的角度來看，這題要先看指標，而且');
    assert.equal(cleaned, '這題要先看指標。');

    const artifact = polishArtifact('## 行動項目\n- Ada — 交付第一版並附驗收依據，而且');
    assert.ok(artifact.includes('- Ada — 交付第一版並附驗收依據。'));
  });

  step('engine.speak references a prior speaker by name in the analysis round', () => {
    const t = engine.speak(analyst, topic, 1, ['Bo Chen'], []);
    assert.ok(t.includes('Bo') || t.includes('Chen'), 'middle round answers a named colleague');
  });

  step('engine.speak weaves grounding in as an earned citation', () => {
    const hits = [{ documentTitle: '結帳轉換率研究', content: '每多一步結帳流程，轉換率平均下降約 10%。' }];
    const grounded = engine.speak(analyst, topic, 0, [], hits);
    assert.ok(grounded.includes('結帳轉換率研究'), 'names the source it was grounded on');
    assert.ok(!grounded.includes('（我看過《結帳轉換率研究》'), 'citation is no longer pasted in as a hard parenthetical aside');
    assert.ok(/《結帳轉換率研究》.*(提醒|寫得很白|對得上|直接寫到)/.test(grounded), 'citation is embedded into the sentence flow');
  });

  step('minutes and report trim topic echo instead of repeating the full title everywhere', () => {
    const longTopic = '把新版結帳流程升級成更順手、可量測、可回滾的三階段轉換方案';
    const third = {
      id: 'emp_c', name: 'Mina Hsu', roleTitle: '後端工程師',
      expertise: ['可靠性', 'API'], personality: '有系統且重視風險',
      communicationStyle: '精確且結構化', objectives: '避免系統在高峰期失手',
    };
    const { transcript, minutes, report } = engine.runMeeting({
      topic: longTopic, participants: [analyst, designer, third], rounds: 3,
    });
    const transcriptText = transcript.map((t) => t.text).join('\n');
    assert.ok((transcriptText.match(new RegExp(longTopic, 'g')) || []).length <= 1, 'transcript does not keep re-injecting the whole topic');
    assert.ok(!minutes.keyPoints.some((line) => line.includes(`「${longTopic}」`)), 'minutes key points avoid quoted full-topic echo');
    assert.ok((report.match(new RegExp(longTopic, 'g')) || []).length <= 1, 'report names the topic once, not over and over');
  });

  step('buildReport produces the sharper Phase 8 section structure', () => {
    const { transcript, minutes, report } = engine.runMeeting({
      topic, participants: [analyst, designer], rounds: 3,
    });
    assert.equal(transcript.length, 6, '2 participants × 3 rounds');
    for (const h of ['## 執行摘要', '## 討論脈絡', '## 決議', '## 行動項目', '## 風險與待解問題']) {
      assert.ok(report.includes(h), `report has ${h}`);
    }
    assert.ok(report.includes(topic), 'report names the topic');
    assert.ok(report.includes('建議展示重點'), 'report reads like a demo artifact');
    assert.ok(report.includes('可 demo') || report.includes('可審查'), 'report emphasises deliverable quality');
    assert.ok(minutes.openQuestions && minutes.openQuestions.length >= 1, 'minutes carry open questions');
    assert.ok(minutes.decisions.every((d) => d.includes('工作線')), 'decisions attribute owned worklines');
    assert.ok(/一開始主張.+後來收斂成|一開始主張/.test(report), 'discussion section synthesizes arcs instead of dumping transcript bullets');
    assert.ok(!report.includes('第1輪 ·'), 'report reads like a polished summary, not transcript formatting');
  });

  step('offline transcript feels like three different colleagues instead of one repeated voice', () => {
    const third = {
      id: 'emp_c', name: 'Mina Hsu', roleTitle: '後端工程師',
      expertise: ['可靠性', 'API'], personality: '有系統且重視風險',
      communicationStyle: '精確且結構化', objectives: '避免系統在高峰期失手',
    };
    const { transcript } = engine.runMeeting({
      topic: '把內部客服機器人做成可 demo 的團隊方案', participants: [analyst, designer, third], rounds: 3,
    });
    const roundOne = transcript.filter((t) => t.round === 1).map((t) => t.text);
    assert.equal(roundOne.length, 3);
    assert.equal(new Set(roundOne).size, 3, 'openings are all distinct');
    assert.ok(roundOne.some((t) => /指標|統計/.test(t)), 'one voice speaks in metrics');
    assert.ok(roundOne.some((t) => /使用者|體驗|流程/.test(t)), 'one voice speaks in user-experience language');
    assert.ok(roundOne.some((t) => /風險|可靠性|驗收/.test(t)), 'one voice speaks in reliability/risk language');
  });

  step('buildCollaborationOutput produces the richer goal structure', () => {
    const { tasks, output } = engine.executeGoal({
      title: '上線 A/B 測試平台', description: '', assignees: [analyst, designer],
    });
    assert.equal(tasks.length, 2);
    for (const h of ['## 目標與成功標準', '## 分工', '## 相依與交接', '## 整合計畫', '## 里程碑與後續步驟']) {
      assert.ok(output.includes(h), `output has ${h}`);
    }
    assert.ok(output.includes('上線 A/B 測試平台'), 'output names the goal');
    assert.ok(output.includes('可 demo') || output.includes('可審查'), 'goal output reads like a demo-ready artifact');
    // Two assignees → distinct approaches, not one boilerplate string repeated.
    assert.notEqual(tasks[0].approach, tasks[1].approach, 'assignees get distinct approaches');
  });

  console.log(`\n  All ${passed} orchestration checks passed ✅\n`);
} catch (err) {
  console.error(`\n  ✗ FAILED after ${passed} checks:`, err.message, '\n', err.stack);
  process.exitCode = 1;
}
