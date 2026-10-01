/**
 * 本地预筛：决定一条消息要不要上传检查。纯本地、不联网。
 *   - 客套短回复（好的 / 收到 / 哈哈 …）→ 不上传
 *   - ≥ 20 字 → 一律检查
 *   - < 20 字 → 只有出现「指人」「敏感事件」「像号码的数字」时才检查
 * 中文信息密度高，「我朋友小李今天在学校被打了」只有 13 个字，所以短句不能按字数一刀切。
 * 词表宁可多列：误判为「要检查」只是多一次请求，漏掉才是问题。
 */

export type GateDecision =
  | { check: true; reason: "long" | "person" | "event" | "number" }
  | { check: false; reason: "empty" | "trivial" | "short" }

export const LONG_TEXT_THRESHOLD = 20

const TRIVIAL_REPLY =
  /^(好的?|好滴|好嘞|好哒|嗯+|哦+|噢+|喔+|收到|了解|明白了?|知道了|懂了|谢谢|谢啦|多谢|感谢|哈+|嘿+|嘻+|呵+|ok|okay|k|yes|no|yep|nope|行|可以|没问题|在吗|在的|晚安|早安|早|午安|拜拜|再见|bye|lol|lmao|thx|thanks|ty|np|666+|\+1|对|是的|不是|不用了?|辛苦了?)[!！.。~～?？,，\s]*$/i

const PERSON_WORDS = [
  "他", "她", "朋友", "同事", "同学", "老师", "老板", "领导", "上司", "经理", "主管", "室友", "舍友",
  "邻居", "亲戚", "我妈", "我爸", "妈妈", "爸爸", "我哥", "我姐", "我弟", "我妹", "老公", "老婆",
  "男朋友", "女朋友", "男友", "女友", "前任", "对象", "闺蜜", "兄弟", "哥们", "客户", "学生",
  "孩子", "儿子", "女儿", "表哥", "表姐", "表弟", "表妹", "堂哥", "堂姐", "叔叔", "阿姨", "舅舅", "舅妈",
  "姑姑", "姨妈", "爷爷", "奶奶", "外公", "外婆", "同桌", "网友", "队友", "学长", "学姐", "师兄", "师姐",
  "学弟", "学妹", "前辈", "徒弟", "老乡", "房东", "租客", "员工", "下属", "病人", "患者", "@"
]

// 小李 / 老王 / 阿强 这类称呼
const NICKNAME = /[小老阿][一-龥]/
const PERSON_EN = /\b(he|she|his|her|him|friends?|boss|coworkers?|co-workers?|colleagues?|roommates?|ex|girlfriend|boyfriend|gf|bf|wife|husband|mom|mum|dad|mother|father|sister|brother|sis|bro|son|daughter|kids?|cousin|aunt|uncle|grandma|grandpa|teacher|classmates?|neighbou?rs?|manager|client|customer|landlord|tenant|patient|someone)\b/i

const EVENT_WORDS = [
  // 健康
  "病", "确诊", "住院", "医院", "手术", "怀孕", "流产", "抑郁", "焦虑", "吃药", "去世", "癌", "精神",
  "艾滋", "HIV", "hiv", "性病", "梅毒", "乙肝", "试管", "不孕", "堕胎", "整容", "抽脂", "自杀", "自残",
  "戒毒", "吸毒", "酗酒", "残疾", "自闭", "瘫",
  // 关系
  "离婚", "分手", "出轨", "劈腿", "吵架", "暧昧", "表白", "同性恋", "喜欢",
  // 财务
  "欠", "借钱", "贷", "工资", "薪", "存款", "破产", "赔钱",
  // 职业 / 学业
  "裁员", "开除", "辞退", "被炒", "失业", "离职", "处分", "挂科", "退学", "绩效",
  // 冲突 / 法律
  "打架", "被打", "家暴", "报警", "警察", "派出所", "坐牢", "判刑", "拘留", "案底", "偷", "骗", "嫖", "赌",
  // 位置 / 身份
  "住在", "住址", "地址", "家在", "电话", "手机号", "身份证", "银行卡", "密码", "学校", "宿舍"
]

// 英文敏感事件：前一组按词首匹配（覆盖 pregnant / pregnancy、divorced / divorcing 这类变形），
// 后一组是容易撞上普通单词的短词（std / cop / gay …），要求整词匹配
const EVENT_EN =
  /\b(pregnan|miscarr|abortion|diagnos|cancer|tumou?r|hospital|surgery|rehab|overdos|depress|anxiety|therap|psychiatr|suicid|self[- ]harm|disabilit|passed away|divorc|cheat|affair|broke up|break ?up|dumped|lesbian|bisexual|transgender|came out|fired|laid off|layoff|expelled|suspended|debt|bankrupt|salary|paycheck|arrest|jail|prison|police|lawsuit|address|phone number|passport|password)|\b(hiv|std|aids|died|gay|trans|owes?|loan|cops?|sued|ssn|lives (at|on|in))\b/i

const NUMBER_LIKE = /\d{5,}|\d+\s*(号|栋|幢|单元|室|楼|弄)/

export function localGate(raw: string): GateDecision {
  const text = raw.trim()
  if (!text) return { check: false, reason: "empty" }
  if (TRIVIAL_REPLY.test(text)) return { check: false, reason: "trivial" }
  if ([...text].length >= LONG_TEXT_THRESHOLD) return { check: true, reason: "long" }
  if (NUMBER_LIKE.test(text)) return { check: true, reason: "number" }
  if (EVENT_WORDS.some(w => text.includes(w)) || EVENT_EN.test(text)) return { check: true, reason: "event" }
  if (PERSON_WORDS.some(w => text.includes(w)) || NICKNAME.test(text) || PERSON_EN.test(text)) {
    return { check: true, reason: "person" }
  }
  return { check: false, reason: "short" }
}
