// Seed the SQLite store with a DEFAULT ASUS (華碩電腦) product-development team:
// seven cross-functional personas plus a research-grounded professional
// knowledge base for each (competitor intel + role domain knowledge, sourced
// from 2025–2026 web research), and one grounded demo meeting so the app is
// instantly explorable. Run: `npm run seed` (this RESETS the database).
//
// The reset wipes demo DATA (employees, knowledge, meetings, goals, dialogues)
// but PRESERVES the user's configuration — API keys, the selected brain, the
// web-search toggle, chair/tunable settings — so a reseed never forces you to
// re-enter your keys. Clear those in the UI if you want a truly blank slate.
import { getDb, resetDb } from './connection.js';
import { getSetting, setSetting } from '../storage/settings.repo.js';
import { insertEmployee } from '../storage/employees.repo.js';
import { insertDocument } from '../storage/knowledge.repo.js';
import { insertMeeting } from '../storage/meetings.repo.js';
import { generateProfile } from '../reasoning/engine.js';
import { getRuntimeAdapter } from '../runtime/index.js';

// Config settings that survive a reseed (painful or careless to lose).
const PRESERVED_SETTING_KEYS = [
  'apiKeyGemini', 'apiKeyTavily', 'llmProvider', 'webSearchEnabled', 'chairConfig', 'tunables',
];

export async function seed() {
  // Snapshot config BEFORE the reset so keys/brain choice survive it.
  const preserved = {};
  try {
    getDb();
    for (const k of PRESERVED_SETTING_KEYS) {
      const v = getSetting(k);
      if (v != null) preserved[k] = v;
    }
  } catch { /* fresh DB — nothing to preserve */ }

  resetDb();

  const make = (data) => insertEmployee({ ...data, profile: generateProfile(data) });

  // ── The default team: a balanced ASUS product-development crew ────────────
  const pm = make({
    name: '林思妤',
    roleTitle: '產品經理',
    personality: '果斷、以商業結果與數據為先，擅長逼出取捨',
    expertise: ['產品路線圖', '規格與成本取捨', '市場定位', '優先級排序（RICE）', 'AI PC 策略'],
    objectives: '在成本、時程與市場三方壓力下，交付真正打中買家需求、避免規格虛榮的產品。',
    communicationStyle: '簡潔且以路線圖與優先級敘事',
  });
  const id = make({
    name: '陳冠宇',
    roleTitle: '工業設計師',
    personality: '重直覺與美感、擇善固執，追求「有意義的設計」',
    expertise: ['工業設計', 'CMF 材質色彩', '人因工學', '品牌設計語言', '永續與可維修'],
    objectives: '打造兼具品牌識別、觸感與可製造性的設計，讓人一眼想擁有、長期愛用。',
    communicationStyle: '以草圖、材質與使用者故事溝通',
  });
  const ee = make({
    name: '王志豪',
    roleTitle: '電子工程師',
    personality: '務實、以電性與物理極限為底線，不接受行銷式承諾',
    expertise: ['電路設計', 'PCB 佈局', '電源管理（PMIC）', '訊號完整性', '運算平台選型', '電池管理（BMS）'],
    objectives: '把平台選型變成穩定、通過電性驗證、電源與熱預算合理的電路板。',
    communicationStyle: '精確、以電壓、瓦數與時序說話',
  });
  const me = make({
    name: '張博翔',
    roleTitle: '機構工程師',
    personality: '重結構與量產可行性，對公差、散熱與可靠度一絲不苟',
    expertise: ['機構設計', '散熱結構（熱管／均熱板）', '機構強度與公差', '電池整合', 'DFM 可製造性', '原型製作'],
    objectives: '把工業設計的外觀變成結構穩固、散熱可行、可量產的真實機構。',
    communicationStyle: '以結構、公差與熱流說話',
  });
  const fw = make({
    name: '黃思翰',
    roleTitle: '韌體／軟體工程師',
    personality: '系統思考、重相依與邊界情況、謹慎',
    expertise: ['BIOS/EC 韌體', '驅動程式', '系統軟體（MyASUS／Armoury Crate）', 'AI／NPU 功能整合'],
    objectives: '交付穩定、不打架的系統軟體與真正有感的 AI 功能，杜絕韌體與驅動不一致。',
    communicationStyle: '結構化、重版本與相依風險',
  });
  const sc = make({
    name: '蔡怡君',
    roleTitle: '供應鏈／採購經理',
    personality: '精算、對成本與風險高度敏感，對承諾保守',
    expertise: ['BOM 成本管控', 'ODM／OEM 管理', '零組件採購', '供應風險', '交期與庫存'],
    objectives: '在記憶體暴漲與關稅動盪下，守住 BOM 成本與交期，並分散供應風險。',
    communicationStyle: '以成本、交期與風險量化說話',
  });
  const mkt = make({
    name: '周庭安',
    roleTitle: '產品行銷經理',
    personality: '市場敏銳、重故事與差異化，但堅持誠實訴求',
    expertise: ['上市策略（GTM）', '產品定位', '競品差異化', '通路與電商', '媒體與評測公關'],
    objectives: '用誠實而有差異化的訊息讓市場理解產品價值，不靠 AI 噱頭堆砌。',
    communicationStyle: '有感染力、以競品與客戶語言溝通',
  });
  const qa = make({
    name: '郭建成',
    roleTitle: '品保／可靠度工程師',
    personality: '嚴謹、獨立、對含糊零容忍，是關卡把關者',
    expertise: ['可靠度驗證', 'EVT/DVT/PVT', '環境與落摔測試', '法規認證', '品質把關'],
    objectives: '以獨立、嚴格的驗證關卡守住品質底線，不合格就不放行量產。',
    communicationStyle: '直接、以測試數據與不合格點說話',
  });
  const fin = make({
    name: 'YuNoTang',
    roleTitle: '成本管理師',
    personality: '謹慎且存疑',
    expertise: ['財務建模', '預算', '預測', '單位經濟'],
    objectives: '負責財務分析師的職責，並透過財務建模協助團隊達成目標。',
    communicationStyle: '以數字為先且保守',
  });

  const employees = [pm, id, ee, me, fw, sc, mkt, qa, fin];

  // ── Professional background knowledge — grounded in 2025–2026 web research,
  //    each doc carries its sources so agents can cite them. [emp, title, body, tags]
  const docs = [
    [pm, 'AI PC 市場與功能取捨',
      'Copilot+ PC 門檻為專屬 NPU ≥40 TOPS、記憶體 ≥16GB、SSD ≥256GB。Canalys 估 2025 年全球 AI PC 出貨突破 5,000 萬台，是消費運算成長最快的區隔；但約 75% 買家覺得「夠用就好」，對高價 AI 機種動機偏低。買家真正有感的 NPU 功能是離線轉錄、視訊通話強化、即時翻譯字幕、本地影像編修與 Recall。決策原則：嚴格區分「真需求」與「規格虛榮」——任何 NPU 功能都要綁一個買家會實際使用的任務，否則不投工程資源。優先級以 RICE（Reach／Impact／Confidence／Effort）排序，市場規模以 TAM／SAM／SOM 界定。\n來源：Canalys、Futurum Q3 2025 PC 報告、digitalapplied AI PC 買家指南。',
      ['策略', 'AI PC']],
    [pm, '競爭態勢與華碩產品線定位',
      '華碩 2025 品牌營收約新台幣 6,889 億元（年增 26%）。客群結構：玩家約 43%（最大支柱）、消費者約 30%、企業約 27%（含 AI 伺服器，快速擴張）。領先領域：主機板全球第一（約 45%）、NVIDIA 生態 AIB 板卡出貨第一；筆電總量全球市佔約 6.9%，落後 Lenovo／HP／Dell。產品線：Zenbook（高階輕薄）、Vivobook（平價全能）、ProArt（創作工作站）、ROG／TUF（電競）、ExpertBook（商用）、ROG Ally（掌機）。主要對手：Apple（M5，能效與單核領先，但封閉、不可維修）、Alienware（頂配電競但笨重）、Lenovo Legion（規模與性價比）、HP Omen、Acer（平價續航的台灣同鄉）、Razer（輕薄精品但量小）。\n來源：Digitimes、Futurum、Statista、GamesRadar。',
      ['競品', '市場']],
    [pm, '產品開發方法論與決策關卡',
      '產品從概念到 EOL 由 PM 全程負責：定義路線圖、目標市場、規格、價格帶與商業論證，設定目標 BOM 成本與毛利，並在各開發關卡（concept→ID→EVT→DVT→PVT→量產）做 go／no-go。核心是取捨：更薄機身 vs 更大電池、更強規格 vs 目標成本、更早上市 vs 零組件供應到位。PM 是把 ID、工程、韌體、供應鏈、行銷對齊到同一份規格與時程的樞紐，並在品保簽核前把關。以 RICE 排序，避免被單一部門偏好綁架。\n來源：HWE.design 開發週期、BestJobDescriptions OEM PM、ProductCompass。',
      ['方法論']],

    [id, '工業設計方法、CMF 與華碩設計語言',
      '工業設計以 CMF（Color／Material／Finish）為核心。華碩設計哲學為「simplicity、method、meaning」——顏色與材質都要「有意義，而非為不同而不同」。主流材料為鋁合金、鎂合金（強度重量比佳，是超薄與電競輕量化的關鍵）與再生材料。核心工程取捨是「薄度 vs 散熱 vs 電池」三角。華碩以自研 Ceraluminum（陶鋁）差異化：結合鋁的輕與陶瓷的韌，較傳統陽極鋁輕約 30%、強 3 倍、不沾指紋、可 100% 回收；於 Milan Design Week 2025 推「Design You Can Feel」，建立有別於 Apple（Space Black 鋁）與 Dell（鎂合金極簡）的觸感語言。\n來源：ASUS Pressroom（Ceraluminum）、ASUS Design Philosophy、Creative Bloq。',
      ['設計', 'CMF']],
    [id, '永續與維修權法規（2025–2026）',
      '歐盟維修權指令（2024/7 生效、2026/7/31 起各國適用）結合 2025 生態設計永續產品法規（ESPR），要求備件於數個工作日內供應、產品停售後仍供零件多年，電池須耐約 ≥800 次循環仍保 ≥80% 容量。設計須內建可拆解性與維修分數；Framework 以 iFixit 可維修性 9.6/10 樹立標竿（對比 MacBook Pro 16 的 3.8/10）。這對華碩一體式輕薄設計形成張力：如何在維持觸感與薄度的同時，提升可維修性與再生料比例。\n來源：歐盟執委會（維修指令／ESPR）、Framework、iFixit。',
      ['永續', '法規']],

    [ee, '運算平台選型（CPU／NPU／GPU）',
      '2025–2026 平台戰場（多在 CES 2026 換代）：Intel Panther Lake（Core Ultra 300、Intel 18A、NPU5 = 50 TOPS、平台合計約 180 TOPS，2026/1 上市）、AMD Ryzen AI 400／MAX+（XDNA 2，旗艦 HX 475 NPU 60 TOPS，MAX 系列統一記憶體最高 128–192GB）、Qualcomm Snapdragon X2 Elite（ARM，第 6 代 Hexagon NPU 80–85 TOPS，2026 H1）、Apple M5 對照（Neural Engine 38 TOPS）。獨顯 NVIDIA RTX 50 Laptop：5090 = 24GB GDDR7／TGP 95–150W；5080 = 16GB GDDR7。Copilot+ 門檻 NPU ≥40 TOPS。選型要一起算合計 TOPS、封裝、記憶體型態（LPDDR5X vs LPCAMM2）與電源／熱預算。\n來源：PCWorld CES 2026、Tom’s Hardware RTX 50、Intel／AMD／Qualcomm newsroom。',
      ['平台', '電子']],
    [ee, '電路設計、電源與電性驗證',
      '電性設計核心：schematic、PCB 佈局與層堆疊、電源管理（PMIC／VRM）、訊號完整性（SI/PI）、EMI/EMC、電池管理（BMS）、USB-C PD 供電、EVT 電性驗證（上電時序、電壓軌穩定、充放電安全）。2025–2026 重點：USB-C PD 3.1 EPR 可達 240W（48V、AVS 100mV 步階）；LPCAMM2 壓接模組縮短走線、改善 SI，速率 7500→9600 MT/s、active 功耗較 DDR5 SODIMM 低約 58%，2026 主流導入。高功耗 AI 運算（NPU＋RTX 50 獨顯 150W TGP）推升 VRM 與熱設計裕度、加嚴 SI/PI 與 EMI/EMC——電源與熱預算必須與機構的散熱容量對齊，否則觸發降頻。\n來源：USB-IF PD 3.1、JEDEC LPCAMM2、業界電源／驗證實務。',
      ['電源', '電池']],
    [me, '機構與散熱結構設計',
      '機構設計整合機殼／底殼、轉軸（hinge）、板件擺放、連接埠與電池佈局，散熱為核心約束。熱導管（heat pipe）沿固定路徑單向傳熱，輕、便宜、適合中階；均熱板（vapor chamber）為扁平密封銅腔，大面積等向擴散，高功率密度下核心溫度更低，為電競／高階首選。2025 ROG Strix G16／G18 採端到端均熱板＋三風扇（Tri-Fan，第三風扇專導 GPU/VRAM 廢熱）＋0.1mm 銅鰭片（總面積約 16.9 萬 mm²），CPU/GPU 雙面塗液態金屬（導熱率達傳統膏 17 倍、降溫達 15°C）。RTX 50 筆電 TGP 上看 175W，與 45–65W CPU 共用單一散熱預算，觸及「薄度 vs 散熱 vs 電池」熱牆：CPU >95–100°C、GPU >85–90°C 即降頻，持續負載可掉速 20–40%。\n來源：ROG Intelligent Cooling、Razer 散熱技術、Box.co.uk RTX 50 throttling。',
      ['機構', '散熱']],
    [me, '機構強度、材料、公差與 DFM 量產',
      '機構材料在強度、重量、成本與永續間取捨。鋁合金剛性佳、易加工；鎂合金比鋁輕約 30–33%，常以 thixomolding（半液態射出）成形——收縮率僅 0.4–0.6%（壓鑄 0.8–1.2%）、晶粒 <50μm、孔隙 <0.3%，但料成本高 50–70%。華碩 Ceraluminum（陶鋁，以純水高壓將鋁電漿陶瓷化）較陽極鋁輕 30%、斷裂韌性達 3 倍、100% 可回收無 VOC，2025 米蘭設計週 Zenbook Signature Edition 全機身採用，Zenbook A14 藉此壓進 1kg 以下。可靠度以 MIL-STD-810H 落摔／震動驗證，靠公差控制與 DFM（標準螺絲取代膠合、模組化）確保良率。EU ESPR／維修權（維修分數手機平板 2025/6 上路，筆電規則預計 2027–2029）推動可拆解、模組化設計。\n來源：ASUS Pressroom（Ceraluminum）、PCWorld 材料、Framework 機構解析、EU ESPR。',
      ['機構', 'DFM']],

    [fw, '系統軟體堆疊與 AI 功能整合',
      '職責涵蓋 BIOS/UEFI、嵌入式控制器（EC）韌體、驅動程式，以及華碩軟體層：MyASUS（主流）與 Armoury Crate（ROG／電競），加上日益重要的 AI 功能（NPU／Copilot+ 體驗、AI 降噪、效能模式）。決定風扇曲線／熱節流邏輯與電源效能設定檔。最大風險是跨界一致性：BIOS 更新後若 EC↔BIOS↔驅動版本不匹配，會造成散熱失控或裝置異常——這是本職經典失效模式，更新機制與版本相依必須嚴格管控。AI 功能要挑買家真正會用的（離線轉錄、即時字幕、本地影像編修），而非湊 TOPS 數字。\n來源：ROG（Armoury Crate vs MyASUS）、WindowsReport（BIOS 更新流程）。',
      ['韌體', 'AI 功能']],

    [sc, '供應鏈、ODM 與 BOM 成本現況',
      '全球筆電逾八成由台灣 ODM 代工：廣達（Quanta）、仁寶（Compal）、和碩（Pegatron）、緯創（Wistron）、英業達（Inventec）。PC ODM 市場 2025 年約 152 億美元。採購核心是把實際 BOM 壓到 PM 的目標成本，並為關鍵零件（面板、電池、記憶體、散熱件）建立第二供應商、鎖定產能與交期。決定 make-vs-buy 與由哪家 ODM 生產，並提供工廠圖面、BOM 與測試標準。部分零件交期仍拉長至逾 30 週，需庫存前置。\n來源：Future Market Insights（PC ODM）、aDreamerTech（OEM／ODM）。',
      ['供應鏈', 'ODM']],
    [sc, '記憶體暴漲與關稅、產地多元化（2025–2026）',
      '2025–2026 供應現實嚴峻：受 AI 伺服器與企業儲存需求排擠，記憶體出現歷史級上漲——NAND 自 2025 年初漲幅達約 246%；2026 第一季 DRAM／NAND／HBM 較前季暴漲約 80–90%，Samsung DDR5 合約價由約 $7 漲逾一倍至 $19.5，產能已排到 2027。應對：長約鎖價、庫存前置、審慎控制單機記憶體容量。關稅與地緣：美國 2025 關稅下筆電雖獲部分豁免，中國製仍受最高 20% 相關稅；越南筆電產量年增約 130%，首度超越中國成美國最大筆電供應國，China+1 多元化加速。\n來源：wccftech、Sourceability、Bloomberg。',
      ['成本', '關稅']],

    [mkt, '上市策略與 AI PC 行銷教訓',
      '消費電子上市（GTM）須整合定位、定價、通路與媒體種子。2025–2026 最大教訓：AI PC 行銷遇冷——Dell 於 CES 2026 坦承對消費者主打「AI 整合」大致失敗，AI 品牌造成混淆而非銷售；實務上仍以價格、電池續航、效能三要素成交。續航訴求須誠實：裝置端 AI 運算會降低續航，誇大易被評測打臉，是信任風險。Q4 2025 出貨筆電已有 54% 含 NPU（其中約四分之一達 40+ TOPS）。\n來源：The Register、TechNewsWorld、Intel Newsroom。',
      ['行銷', 'AI PC']],
    [mkt, '分眾戰場與競品差異化',
      '市場已清楚分眾：（1）續航優先的 ARM 機種（Snapdragon X 系列）；（2）AI 感知的 Intel／AMD NPU 系統；（3）效能優先的電競／創作者機種（NVIDIA 獨顯）。訊息要對族群說話：學生／差旅重攜帶、續航、鍵盤手感；創作者／工程師重顯示、效能、散熱；商務重耐用、安全、擴充。差異化槓桿：華碩的雙螢幕（Zenbook DUO）、Ceraluminum 觸感、ROG 電競生態與 Armoury Crate。通路須實體零售與電商並重，並以評測媒體／KOL 種子鋪陳口碑。\n來源：Intel 2025 AI PC 買家指南、競品評測。',
      ['分眾', '競品']],

    [fin, '硬體產品的單位經濟與財務建模',
      '成本管理的核心是把「單台賬」算清楚：BOM 物料成本、製造與組裝（含良率損耗與返工）、運費關稅、保固準備金、通路分潤與行銷分攤，逐層堆出單位經濟（unit economics），再對照零售價格得出毛利瀑布。消費性 PC／筆電硬體的健康毛利帶約 28–32%；任何規格加項都要換算成「單台增量成本 × 預估量」的全成本，而非只看料號差價——公差鏈失敗率、良率爬坡損耗、認證費用攤提都要進模型。方法上以三情境（樂觀／基準／悲觀）做敏感度分析，關鍵變數（記憶體價格、匯率、關稅、良率）各自設觸發門檻：超線就啟動砍規格或改設計，不動毛利底線。預測要保守：緩衝抓上限而非均值，未鎖價的報價一律按悲觀情境計。\n來源：業界 BOM／毛利實務、本團隊供應鏈與品保文件交叉引用。',
      ['財務', '單位經濟']],
    [fin, '2025–2026 成本風險現實（記憶體、關稅、匯率）',
      '目前最大的單台成本變數是記憶體：受 AI 伺服器需求排擠，NAND 自 2025 年初累計漲幅約 246%，2026 年第一季 DRAM／NAND／HBM 較前季暴漲約 80–90%，Samsung DDR5 合約價由約 $7 漲逾一倍至 $19.5——未鎖價的記憶體項目在財務模型裡必須按悲觀情境入賬。關稅面：美國 2025 年關稅下筆電雖獲部分豁免，中國製仍受最高 20% 附加稅；產地多元化（越南年增約 130%）帶來轉移成本與新產線良率爬坡損耗，都應列入過渡期預算。財務紀律：對沖手段是長約鎖價、庫存前置與規格彈性（可降規的替代料先驗證好），並在專案立案時就設定「成本超線即砍規格、不砍毛利」的決策規則,避免上市前夕被動漲價。\n來源：wccftech、Sourceability、Bloomberg（同供應鏈文件）。',
      ['成本', '風險']],
    [qa, '可靠度驗證關卡與認證標準',
      '品保是量產前的獨立簽核。硬體開發依 EVT（工程驗證）→DVT（設計驗證）→PVT（量產驗證）關卡推進，每關對電性、機構、散熱、系統做嚴格測試；PC OEM 的測試程序常達數萬步驟。可靠度以 MIL-STD-810H 為基準（約 28 項極端溫濕度、震動、落摔），加上環境測試、HTOL 高溫壽命與熱衝擊。無障礙硬體須對生理、感官、動作、認知障礙實測。原則：不合格就不放行——含糊、未達門檻的項目一律擋下，這是對品質底線的最後把關。\n來源：ToughRuggedLaptops（MIL-STD）、HP MIL-STD-810 白皮書、HWE.design（EVT/DVT）。',
      ['品保', '認證']],
  ];
  for (const [emp, title, content, tags] of docs) {
    insertDocument(emp.id, { title, content, tags, source: 'note' });
  }

  // One grounded demo meeting through the default (standalone) runtime. With no
  // brain configured yet (keys are restored AFTER this), it runs on the offline
  // deterministic engine — fast, free, and always available.
  const runtime = getRuntimeAdapter('standalone');
  const participants = [pm, id, ee, me, sc];
  const topic = '2026 下半年 Zenbook 旗艦的 AI PC 定位與規格取捨';
  const result = await runtime.runMeeting({ topic, participants, rounds: 3 });
  insertMeeting({
    topic,
    participantIds: participants.map((p) => p.id),
    participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    rounds: 3,
    transcript: result.transcript,
    minutes: result.minutes,
    report: result.report,
    grounding: result.grounding,
    runtime: result.runtime,
  });

  // Restore preserved config (API keys, brain choice, toggles) so the reseed
  // never costs the user their setup.
  for (const [k, v] of Object.entries(preserved)) setSetting(k, v);

  return { employees: employees.length, documents: docs.length, meetings: 1, preserved: Object.keys(preserved).length };
}

// Run when invoked directly. (Async IIFE, not top-level await — the exe build
// bundles everything to CommonJS, which has no TLA.)
//
// isPackaged() guard: under a SEA exe, argv[1] IS the exe path and the bundled
// import.meta.url is shimmed to the same path, so this "am I the main script?"
// check would fire for EVERY module carrying it — when index.js dynamically
// imports this module to first-boot-seed, the tail would launch a SECOND,
// concurrent seed (observed: a fresh exe DB with two identical demo meetings).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPackaged } from '../util/portable.js';
if (!isPackaged() && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const counts = await seed();
    console.log(`已建立 ${counts.employees} 位員工、${counts.documents} 份知識文件、${counts.meetings} 場會議（保留 ${counts.preserved} 項設定）。`);
  })();
}
