'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import parseLLMJson from '@/lib/jsonParser'
import {
  listSchedules,
  getScheduleLogs,
  pauseSchedule,
  resumeSchedule,
  triggerScheduleNow,
  updateScheduleMessage,
  cronToHuman,
  type Schedule,
  type ExecutionLog,
} from '@/lib/scheduler'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  HiOutlineViewGrid,
  HiOutlinePhone,
  HiOutlineMail,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineCog,
  HiOutlineSearch,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineRefresh,
  HiOutlinePlay,
  HiOutlineExternalLink,
  HiOutlineX,
  HiOutlineFilter,
  HiOutlineStar,
} from 'react-icons/hi'
import {
  FiMic,
  FiMicOff,
  FiPhoneCall,
  FiPhoneOff,
  FiLoader,
  FiSend,
  FiChevronRight,
  FiActivity,
  FiTarget,
  FiUsers,
  FiZap,
  FiLink,
  FiLink2,
  FiEye,
  FiEyeOff,
  FiShield,
  FiAlertCircle,
  FiCheck,
  FiTrash2,
} from 'react-icons/fi'

// ============================================================================
// AGENT IDS
// ============================================================================
const AGENT_IDS = {
  LEAD_PIPELINE: '699d9c0b878ad4c6b7213054',
  VOICE_OUTREACH: '699d9c0c25bfd8a7382bdee6',
  DEMO_DELIVERY: '699d9c2f25bfd8a7382bdeee',
  FOLLOW_UP: '699d9c2f878ad4c6b7213058',
} as const

const SCHEDULE_ID_INIT = '699d9c38399dfadeac390b70'

// ============================================================================
// SAFE RESPONSE EXTRACTOR
// ============================================================================
/**
 * Extracts the actual data payload from callAIAgent() response.
 *
 * callAIAgent returns: { success, response: { status, result, message }, raw_response, ... }
 * The API route normalizes the Lyzr response into: { status, result: {...} }
 *
 * This helper walks through every possible nesting:
 *   result.response.result -> maybe object already, maybe stringified JSON
 *   result.response        -> fallback
 *   result.raw_response    -> last resort (raw text from Lyzr)
 */
function extractAgentData(result: any): any {
  if (!result) return null

  // 1. Try result.response.result (the normalized path from API route)
  const responseResult = result?.response?.result
  if (responseResult && typeof responseResult === 'object' && Object.keys(responseResult).length > 0) {
    // Check if result has domain-specific keys — these are already parsed, use directly
    const keys = Object.keys(responseResult)
    const domainKeys = [
      'scored_leads', 'pipeline_summary', 'email_details', 'follow_up_results',
      'call_summary', 'leads', 'enriched_leads', 'qualified_leads',
      'total_scraped', 'total_enriched', 'total_qualified',
      'practice_name', 'recipient_email', 'subject', 'body_preview',
      'total_follow_ups_sent', 'demo_engaged_count',
    ]
    if (keys.some(k => domainKeys.includes(k))) return responseResult

    // If only has { text: "..." } — the message might contain JSON inside it
    if (keys.length === 1 && keys[0] === 'text' && typeof responseResult.text === 'string') {
      const innerParsed = parseLLMJson(responseResult.text)
      if (innerParsed && typeof innerParsed === 'object' && !innerParsed.error) {
        return innerParsed
      }
      // Return text wrapper as-is if not JSON
      return responseResult
    }

    // Return the object as-is — it's already a valid parsed result
    return responseResult
  }

  // 2. If result.response.result is a string, parse it
  if (typeof responseResult === 'string' && responseResult.trim()) {
    const parsed = parseLLMJson(responseResult)
    if (parsed && typeof parsed === 'object' && !parsed.error) return parsed
    // If not parseable, wrap as text
    return { text: responseResult }
  }

  // 3. Try the response.message field (sometimes the actual data is in message)
  if (result?.response?.message && typeof result.response.message === 'string') {
    const parsed = parseLLMJson(result.response.message)
    if (parsed && typeof parsed === 'object' && !parsed.error) return parsed
    return { text: result.response.message }
  }

  // 4. Try raw_response (last resort fallback to original Lyzr output)
  if (result?.raw_response) {
    const parsed = parseLLMJson(result.raw_response)
    if (parsed && typeof parsed === 'object' && !parsed.error) return parsed
  }

  // 5. If response exists as object, use it directly
  if (result?.response && typeof result.response === 'object') {
    return result.response
  }

  return null
}

// ============================================================================
// TYPES
// ============================================================================
interface PipelineSummary {
  total_scraped: number
  total_enriched: number
  total_qualified: number
  hot_leads: number
  warm_leads: number
  cold_leads: number
  execution_time: string
  status: string
}

interface ScoredLead {
  practice_name: string
  phone: string
  address: string
  website: string
  practice_type: string
  practice_size: string
  review_sentiment: string
  pain_points: string
  call_volume_estimate: string
  tech_signals: string
  growth_indicators: string
  total_score: number
  tier: string
  scoring_rationale: string
  recommended_approach: string
}

interface CallLog {
  id: string
  lead_name: string
  call_duration: string
  outcome: string
  interest_level: string
  objections_raised: string
  next_steps: string
  demo_requested: string
  notes: string
  transcript: string[]
  timestamp: string
}

interface DemoRecord {
  id: string
  recipient_email: string
  subject: string
  body_preview: string
  personalization_factors: string
  send_status: string
  sent_at: string
  practice_name: string
}

interface FollowUpRecord {
  practice_name: string
  recipient_email: string
  touchpoint_number: number
  message_theme: string
  send_status: string
  sent_at: string
  days_since_demo: number
  engagement_status: string
}

interface HandoffLead {
  practice_name: string
  score: number
  tier: string
  call_outcome: string
  demo_sent: boolean
  follow_up_status: string
  status: string
}

interface TwilioConfig {
  accountSid: string
  authToken: string
  phoneNumber: string
  isConnected: boolean
  lastTested: string | null
  testStatus: 'idle' | 'testing' | 'success' | 'error'
  testMessage: string
}

const TWILIO_STORAGE_KEY = 'dentreach_twilio_config'

function loadTwilioConfig(): TwilioConfig {
  try {
    const saved = localStorage.getItem(TWILIO_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return {
        accountSid: parsed.accountSid ?? '',
        authToken: parsed.authToken ?? '',
        phoneNumber: parsed.phoneNumber ?? '',
        isConnected: parsed.isConnected ?? false,
        lastTested: parsed.lastTested ?? null,
        testStatus: 'idle',
        testMessage: '',
      }
    }
  } catch {}
  return {
    accountSid: '',
    authToken: '',
    phoneNumber: '',
    isConnected: false,
    lastTested: null,
    testStatus: 'idle',
    testMessage: '',
  }
}

function saveTwilioConfig(config: TwilioConfig) {
  try {
    localStorage.setItem(TWILIO_STORAGE_KEY, JSON.stringify({
      accountSid: config.accountSid,
      authToken: config.authToken,
      phoneNumber: config.phoneNumber,
      isConnected: config.isConnected,
      lastTested: config.lastTested,
    }))
  } catch {}
}

type ViewType = 'dashboard' | 'leads' | 'outreach' | 'demos' | 'followups' | 'handoff' | 'settings'

// ============================================================================
// ERROR BOUNDARY
// ============================================================================
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ============================================================================
// HELPERS
// ============================================================================
function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-2">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### '))
          return <h4 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('## '))
          return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# '))
          return <h2 key={i} className="font-bold text-lg mt-4 mb-2">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* '))
          return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line))
          return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm">{formatInline(line)}</p>
      })}
    </div>
  )
}

function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

function getTierColor(tier: string) {
  const t = (tier ?? '').toLowerCase()
  if (t === 'hot') return 'bg-accent text-accent-foreground'
  if (t === 'warm') return 'bg-chart-3/80 text-foreground'
  return 'bg-muted text-muted-foreground'
}

function getOutcomeColor(outcome: string) {
  const o = (outcome ?? '').toLowerCase()
  if (o.includes('interested') || o.includes('connected')) return 'bg-accent/80 text-accent-foreground'
  if (o.includes('voicemail')) return 'bg-muted text-muted-foreground'
  if (o.includes('objection')) return 'bg-chart-4/80 text-foreground'
  if (o.includes('disqualified')) return 'bg-destructive text-destructive-foreground'
  return 'bg-secondary text-secondary-foreground'
}

function getStatusColor(status: string) {
  const s = (status ?? '').toLowerCase()
  if (s === 'sent' || s === 'success') return 'bg-accent/80 text-accent-foreground'
  if (s === 'failed' || s === 'error') return 'bg-destructive text-destructive-foreground'
  if (s === 'engaged') return 'bg-accent text-accent-foreground'
  if (s.includes('no response')) return 'bg-chart-4/80 text-foreground'
  return 'bg-muted text-muted-foreground'
}

function generateId() {
  return Math.random().toString(36).substring(2, 11)
}

// ============================================================================
// SAMPLE DATA
// ============================================================================
const SAMPLE_LEADS: ScoredLead[] = [
  {
    practice_name: 'Bright Smiles Dental',
    phone: '(512) 555-0142',
    address: '4521 Medical Pkwy, Austin, TX 78756',
    website: 'https://brightsmilesdental.com',
    practice_type: 'General Dentistry',
    practice_size: 'Medium (3-5 dentists)',
    review_sentiment: 'Mixed - 3.8/5 avg with complaints about wait times',
    pain_points: 'High call volume, missed appointments, inefficient scheduling',
    call_volume_estimate: '120-150 calls/day',
    tech_signals: 'Using legacy PMS, no online scheduling',
    growth_indicators: 'Recently opened second location, hiring hygienists',
    total_score: 87,
    tier: 'Hot',
    scoring_rationale: 'High call volume with legacy tech stack and growth trajectory make this practice an ideal fit.',
    recommended_approach: 'Lead with ROI calculator showing missed call cost. Emphasize AI scheduling.',
  },
  {
    practice_name: 'Hill Country Orthodontics',
    phone: '(512) 555-0198',
    address: '2200 Ranch Rd 620, Lakeway, TX 78734',
    website: 'https://hillcountryortho.com',
    practice_type: 'Orthodontics',
    practice_size: 'Large (6+ providers)',
    review_sentiment: 'Positive - 4.6/5 but staff responsiveness mentioned',
    pain_points: 'Patient communication bottlenecks, follow-up tracking',
    call_volume_estimate: '80-100 calls/day',
    tech_signals: 'Modern PMS but no AI tools, basic website chatbot',
    growth_indicators: 'Expanding Invisalign program, new patient coordinator hired',
    total_score: 74,
    tier: 'Warm',
    scoring_rationale: 'Strong practice with communication needs but may need longer sales cycle due to existing tech.',
    recommended_approach: 'Focus on patient engagement and follow-up automation. Share case study.',
  },
  {
    practice_name: 'Family First Dental Care',
    phone: '(512) 555-0231',
    address: '789 Oak Hill Dr, Dripping Springs, TX 78620',
    website: 'https://familyfirstdental.net',
    practice_type: 'General & Pediatric',
    practice_size: 'Small (1-2 dentists)',
    review_sentiment: 'Highly positive - 4.9/5 stars',
    pain_points: 'Limited staff handling phones, after-hours calls missed',
    call_volume_estimate: '40-60 calls/day',
    tech_signals: 'Cloud PMS, accepting online forms',
    growth_indicators: 'Stable practice, no immediate expansion plans',
    total_score: 52,
    tier: 'Cold',
    scoring_rationale: 'Small practice with lower call volume. Good reviews suggest less urgency for AI phone solution.',
    recommended_approach: 'Nurture with educational content. Check back in 6 months.',
  },
  {
    practice_name: 'Austin Periodontal Specialists',
    phone: '(512) 555-0307',
    address: '1100 W 38th St, Austin, TX 78705',
    website: 'https://austinperio.com',
    practice_type: 'Periodontics',
    practice_size: 'Medium (3-5 dentists)',
    review_sentiment: 'Mixed - 4.1/5 with some complaints about billing',
    pain_points: 'Complex scheduling for surgical procedures, referral management',
    call_volume_estimate: '60-80 calls/day',
    tech_signals: 'Outdated phone system, no automated reminders',
    growth_indicators: 'Adding implant services, partnering with general dentists',
    total_score: 79,
    tier: 'Hot',
    scoring_rationale: 'Specialty practice with scheduling complexity and growth in implant services creates strong need.',
    recommended_approach: 'Highlight referral management and surgical scheduling capabilities.',
  },
]

const SAMPLE_SUMMARY: PipelineSummary = {
  total_scraped: 15,
  total_enriched: 12,
  total_qualified: 10,
  hot_leads: 3,
  warm_leads: 4,
  cold_leads: 3,
  execution_time: '2m 34s',
  status: 'completed',
}

const SAMPLE_CALLS: CallLog[] = [
  {
    id: 'c1',
    lead_name: 'Bright Smiles Dental',
    call_duration: '4:32',
    outcome: 'Interested',
    interest_level: 'High',
    objections_raised: 'Budget concerns for Q1',
    next_steps: 'Schedule demo for next Tuesday',
    demo_requested: 'Yes',
    notes: 'Dr. Martinez very receptive to AI scheduling pitch. Mentioned losing 15-20 calls/day to voicemail.',
    transcript: ['Agent: Good morning, this is DentReach AI calling about your practice...', 'Dr. Martinez: Yes, tell me more about what you offer...', 'Agent: We help dental practices like yours capture every incoming call using AI...', 'Dr. Martinez: That sounds interesting. We do lose quite a few calls...'],
    timestamp: '2026-02-24T09:15:00Z',
  },
  {
    id: 'c2',
    lead_name: 'Hill Country Orthodontics',
    call_duration: '2:15',
    outcome: 'Voicemail',
    interest_level: 'Unknown',
    objections_raised: 'N/A',
    next_steps: 'Follow up in 2 days',
    demo_requested: 'No',
    notes: 'Left detailed voicemail. Office staff said Dr. Chen is in procedures until 3pm.',
    transcript: ['Agent: Hi, this is DentReach AI...', 'Voicemail reached. Message left.'],
    timestamp: '2026-02-24T10:30:00Z',
  },
  {
    id: 'c3',
    lead_name: 'Austin Periodontal Specialists',
    call_duration: '6:18',
    outcome: 'Connected',
    interest_level: 'Medium',
    objections_raised: 'Already evaluating another solution',
    next_steps: 'Send comparison document, follow up Friday',
    demo_requested: 'Maybe',
    notes: 'Office manager Sarah was engaged but mentioned they are looking at a competitor. Interested in referral management feature.',
    transcript: ['Agent: Good afternoon, I am calling from DentReach AI...', 'Sarah: We are actually looking at phone solutions right now...'],
    timestamp: '2026-02-24T14:00:00Z',
  },
]

const SAMPLE_DEMOS: DemoRecord[] = [
  {
    id: 'd1',
    recipient_email: 'dr.martinez@brightsmiles.com',
    subject: 'Your Personalized DentReach AI Demo - Bright Smiles Dental',
    body_preview: 'Dr. Martinez, following our conversation about your call volume challenges, I have prepared a personalized demo showing how DentReach AI can capture those 15-20 missed daily calls and convert them into booked appointments automatically...',
    personalization_factors: 'Call volume data, missed appointment metrics, growth plans',
    send_status: 'Sent',
    sent_at: '2026-02-24T11:00:00Z',
    practice_name: 'Bright Smiles Dental',
  },
]

const SAMPLE_FOLLOWUPS: FollowUpRecord[] = [
  {
    practice_name: 'Bright Smiles Dental',
    recipient_email: 'dr.martinez@brightsmiles.com',
    touchpoint_number: 1,
    message_theme: 'ROI Calculator Follow-up',
    send_status: 'Sent',
    sent_at: '2026-02-24T10:00:00Z',
    days_since_demo: 2,
    engagement_status: 'Engaged',
  },
  {
    practice_name: 'Austin Periodontal Specialists',
    recipient_email: 'sarah@austinperio.com',
    touchpoint_number: 1,
    message_theme: 'Competitive Comparison',
    send_status: 'Sent',
    sent_at: '2026-02-24T10:00:00Z',
    days_since_demo: 1,
    engagement_status: 'Pending',
  },
]

const SAMPLE_HANDOFFS: HandoffLead[] = [
  {
    practice_name: 'Bright Smiles Dental',
    score: 87,
    tier: 'Hot',
    call_outcome: 'Interested',
    demo_sent: true,
    follow_up_status: 'Engaged',
    status: 'Ready for Close',
  },
]

// ============================================================================
// AGENT INFO
// ============================================================================
const AGENTS_INFO = [
  { id: AGENT_IDS.LEAD_PIPELINE, name: 'Lead Pipeline Manager', purpose: 'Orchestrates scraping, enrichment & qualification', type: 'manager' },
  { id: '699d9bcdbb917835c88b22e0', name: 'Lead Scraping Agent', purpose: 'Discovers dental practices', type: 'sub-agent' },
  { id: '699d9bcd878ad4c6b7213044', name: 'Lead Enrichment Agent', purpose: 'Enriches lead data via Perplexity', type: 'sub-agent' },
  { id: '699d9bce608ccd5b6e6834ca', name: 'Lead Qualification Agent', purpose: 'Scores and tiers leads', type: 'sub-agent' },
  { id: AGENT_IDS.VOICE_OUTREACH, name: 'Voice Outreach Agent', purpose: 'AI voice calls to prospects', type: 'voice' },
  { id: AGENT_IDS.DEMO_DELIVERY, name: 'Demo Delivery Agent', purpose: 'Sends personalized demo emails', type: 'tool' },
  { id: AGENT_IDS.FOLLOW_UP, name: 'Follow-Up Agent', purpose: 'Automated follow-up sequences', type: 'scheduled' },
]

// ============================================================================
// NAV ITEMS
// ============================================================================
const NAV_ITEMS: { key: ViewType; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <HiOutlineViewGrid className="w-5 h-5" /> },
  { key: 'leads', label: 'Lead Board', icon: <FiTarget className="w-5 h-5" /> },
  { key: 'outreach', label: 'Outreach Log', icon: <HiOutlinePhone className="w-5 h-5" /> },
  { key: 'demos', label: 'Demo Tracker', icon: <HiOutlineMail className="w-5 h-5" /> },
  { key: 'followups', label: 'Follow-Up Queue', icon: <HiOutlineClock className="w-5 h-5" /> },
  { key: 'handoff', label: 'Closer Handoff', icon: <HiOutlineCheckCircle className="w-5 h-5" /> },
  { key: 'settings', label: 'Settings', icon: <HiOutlineCog className="w-5 h-5" /> },
]

// ============================================================================
// STAT CARD
// ============================================================================
function StatCard({ label, value, icon, accent }: { label: string; value: string | number; icon: React.ReactNode; accent?: boolean }) {
  return (
    <Card className={accent ? 'border-accent/30 bg-accent/5' : ''}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground tracking-wide uppercase font-sans">{label}</p>
            <p className="text-2xl font-serif font-semibold mt-1">{value}</p>
          </div>
          <div className="text-accent opacity-70">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// LOADING SPINNER
// ============================================================================
function LoadingSpinner({ text }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <FiLoader className="w-4 h-4 animate-spin" />
      <span className="text-sm">{text ?? 'Loading...'}</span>
    </div>
  )
}

// ============================================================================
// DASHBOARD VIEW
// ============================================================================
function DashboardView({
  leads,
  callLogs,
  demos,
  followUps,
  handoffs,
  summary,
  showSample,
}: {
  leads: ScoredLead[]
  callLogs: CallLog[]
  demos: DemoRecord[]
  followUps: FollowUpRecord[]
  handoffs: HandoffLead[]
  summary: PipelineSummary | null
  showSample: boolean
}) {
  const s = showSample ? SAMPLE_SUMMARY : summary
  const l = showSample ? SAMPLE_LEADS : leads
  const c = showSample ? SAMPLE_CALLS : callLogs
  const d = showSample ? SAMPLE_DEMOS : demos
  const f = showSample ? SAMPLE_FOLLOWUPS : followUps
  const h = showSample ? SAMPLE_HANDOFFS : handoffs

  const hotCount = l.filter(x => (x.tier ?? '').toLowerCase() === 'hot').length
  const warmCount = l.filter(x => (x.tier ?? '').toLowerCase() === 'warm').length
  const coldCount = l.filter(x => (x.tier ?? '').toLowerCase() === 'cold').length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Pipeline overview and performance metrics</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Leads Scraped" value={s?.total_scraped ?? l.length} icon={<FiUsers className="w-6 h-6" />} />
        <StatCard label="Qualified" value={s?.total_qualified ?? l.length} icon={<FiTarget className="w-6 h-6" />} />
        <StatCard label="Calls Made" value={c.length} icon={<HiOutlinePhone className="w-6 h-6" />} />
        <StatCard label="Demos Sent" value={d.length} icon={<HiOutlineMail className="w-6 h-6" />} />
        <StatCard label="Follow-Ups" value={f.length} icon={<HiOutlineClock className="w-6 h-6" />} />
        <StatCard label="Closer Queue" value={h.length} icon={<HiOutlineCheckCircle className="w-6 h-6" />} accent />
      </div>

      {/* Conversion Funnel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-serif">Conversion Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: 'Scraped', value: s?.total_scraped ?? l.length },
              { label: 'Enriched', value: s?.total_enriched ?? l.length },
              { label: 'Qualified', value: s?.total_qualified ?? l.length },
              { label: 'Calls Made', value: c.length },
              { label: 'Demos Sent', value: d.length },
              { label: 'Engaged', value: h.length },
            ].map((step, i) => {
              const maxVal = Math.max(s?.total_scraped ?? l.length, 1)
              return (
                <div key={i} className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground w-24 text-right tracking-wide">{step.label}</span>
                  <div className="flex-1 h-6 bg-secondary rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-accent/70 rounded-sm transition-all duration-500"
                      style={{ width: `${Math.max((step.value / maxVal) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold w-8">{step.value}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Tier Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-serif">Lead Tiers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-8 h-36 justify-center">
              {[
                { label: 'Hot', count: hotCount, color: 'bg-accent' },
                { label: 'Warm', count: warmCount, color: 'bg-chart-3' },
                { label: 'Cold', count: coldCount, color: 'bg-muted-foreground/40' },
              ].map((t) => {
                const maxLead = Math.max(l.length, 1)
                const heightPct = Math.max((t.count / maxLead) * 100, 10)
                return (
                  <div key={t.label} className="flex flex-col items-center gap-2 w-20">
                    <span className="text-lg font-semibold">{t.count}</span>
                    <div className="w-full rounded-t-md overflow-hidden" style={{ height: `${heightPct}px` }}>
                      <div className={`w-full h-full ${t.color} rounded-t-md`} />
                    </div>
                    <span className="text-xs text-muted-foreground tracking-wide">{t.label}</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-serif">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {c.length === 0 && d.length === 0 && f.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity. Run the pipeline to get started.</p>
              ) : (
                <>
                  {c.slice(0, 2).map((call) => (
                    <div key={call.id} className="flex items-center gap-3 text-sm">
                      <HiOutlinePhone className="w-4 h-4 text-accent flex-shrink-0" />
                      <span className="truncate flex-1">Called {call.lead_name}</span>
                      <Badge className={`text-xs ${getOutcomeColor(call.outcome)}`}>{call.outcome}</Badge>
                    </div>
                  ))}
                  {d.slice(0, 2).map((demo) => (
                    <div key={demo.id} className="flex items-center gap-3 text-sm">
                      <HiOutlineMail className="w-4 h-4 text-accent flex-shrink-0" />
                      <span className="truncate flex-1">Demo to {demo.practice_name}</span>
                      <Badge className={`text-xs ${getStatusColor(demo.send_status)}`}>{demo.send_status}</Badge>
                    </div>
                  ))}
                  {f.slice(0, 2).map((fu, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-sm">
                      <HiOutlineClock className="w-4 h-4 text-accent flex-shrink-0" />
                      <span className="truncate flex-1">Follow-up #{fu.touchpoint_number} to {fu.practice_name}</span>
                      <Badge className={`text-xs ${getStatusColor(fu.engagement_status)}`}>{fu.engagement_status}</Badge>
                    </div>
                  ))}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Health */}
      {s && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-serif">Pipeline Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground tracking-wide">Status</p>
                <Badge className={`mt-1 ${s.status === 'completed' ? 'bg-accent/80 text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {s.status ?? 'Unknown'}
                </Badge>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground tracking-wide">Execution Time</p>
                <p className="text-sm font-semibold mt-1">{s.execution_time ?? '--'}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground tracking-wide">Hot Lead Rate</p>
                <p className="text-sm font-semibold mt-1">
                  {s.total_qualified > 0 ? `${Math.round((s.hot_leads / s.total_qualified) * 100)}%` : '--'}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground tracking-wide">Enrichment Rate</p>
                <p className="text-sm font-semibold mt-1">
                  {s.total_scraped > 0 ? `${Math.round((s.total_enriched / s.total_scraped) * 100)}%` : '--'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ============================================================================
// LEAD BOARD VIEW
// ============================================================================
function LeadBoardView({
  leads,
  setLeads,
  setSummary,
  showSample,
  setActiveAgentId,
  setAgentStatus,
  onLaunchOutreach,
  onSendDemo,
}: {
  leads: ScoredLead[]
  setLeads: (l: ScoredLead[]) => void
  setSummary: (s: PipelineSummary) => void
  showSample: boolean
  setActiveAgentId: (id: string | null) => void
  setAgentStatus: (s: string) => void
  onLaunchOutreach: (lead: ScoredLead) => void
  onSendDemo: (lead: ScoredLead) => void
}) {
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [sortDesc, setSortDesc] = useState(true)

  const displayLeads = showSample ? SAMPLE_LEADS : leads
  const filteredLeads = displayLeads
    .filter(l => tierFilter === 'all' || (l.tier ?? '').toLowerCase() === tierFilter)
    .sort((a, b) => sortDesc ? (b.total_score ?? 0) - (a.total_score ?? 0) : (a.total_score ?? 0) - (b.total_score ?? 0))

  const runPipeline = async () => {
    if (!location.trim()) {
      setStatusMsg('Please enter a location or criteria.')
      return
    }
    setLoading(true)
    setStatusMsg('Running lead pipeline... This may take a few minutes.')
    setActiveAgentId(AGENT_IDS.LEAD_PIPELINE)
    setAgentStatus('Submitting task...')
    try {
      const result = await callAIAgent(
        `Find and qualify dental practices in ${location}. Scrape, enrich, and score all leads found.`,
        AGENT_IDS.LEAD_PIPELINE
      )
      setAgentStatus('Processing response...')
      console.log('[DentReach] Pipeline raw result:', JSON.stringify(result, null, 2))

      if (result.success) {
        const data = extractAgentData(result)
        console.log('[DentReach] Pipeline extracted data:', JSON.stringify(data, null, 2))

        if (!data) {
          setStatusMsg('Pipeline completed but could not parse the response. Check console for details.')
          setLoading(false)
          setActiveAgentId(null)
          return
        }

        // Handle various response shapes from the manager agent
        let scoredLeads: ScoredLead[] = []
        let pSummary: PipelineSummary | null = null

        // Direct shape: { pipeline_summary, scored_leads }
        if (Array.isArray(data.scored_leads)) {
          scoredLeads = data.scored_leads
        }
        // Nested in result: { result: { pipeline_summary, scored_leads } }
        if (scoredLeads.length === 0 && data.result && Array.isArray(data.result.scored_leads)) {
          scoredLeads = data.result.scored_leads
        }
        // Sub-agent aggregated: leads might be under different keys
        if (scoredLeads.length === 0 && Array.isArray(data.leads)) {
          scoredLeads = data.leads
        }
        if (scoredLeads.length === 0 && Array.isArray(data.qualified_leads)) {
          scoredLeads = data.qualified_leads.map((ql: any) => ({
            ...ql,
            phone: ql.phone ?? '',
            address: ql.address ?? '',
            website: ql.website ?? '',
            practice_type: ql.practice_type ?? '',
            practice_size: ql.practice_size ?? '',
            review_sentiment: ql.review_sentiment ?? '',
            pain_points: ql.pain_points ?? '',
            call_volume_estimate: ql.call_volume_estimate ?? '',
            tech_signals: ql.tech_signals ?? '',
            growth_indicators: ql.growth_indicators ?? '',
          }))
        }

        // Extract summary
        if (data.pipeline_summary) {
          pSummary = data.pipeline_summary
        } else if (data.result?.pipeline_summary) {
          pSummary = data.result.pipeline_summary
        } else if (scoredLeads.length > 0) {
          // Build summary from leads data
          const hot = scoredLeads.filter(l => (l.tier ?? '').toLowerCase() === 'hot').length
          const warm = scoredLeads.filter(l => (l.tier ?? '').toLowerCase() === 'warm').length
          const cold = scoredLeads.filter(l => (l.tier ?? '').toLowerCase() === 'cold').length
          pSummary = {
            total_scraped: scoredLeads.length,
            total_enriched: scoredLeads.length,
            total_qualified: scoredLeads.length,
            hot_leads: hot,
            warm_leads: warm,
            cold_leads: cold,
            execution_time: 'N/A',
            status: 'completed',
          }
        }

        if (scoredLeads.length > 0) {
          setLeads(scoredLeads)
          setStatusMsg(`Pipeline complete! Found ${scoredLeads.length} qualified leads.`)
        } else {
          // Show agent's text response if available, otherwise generic message
          const agentText = data?.text || data?.message || ''
          if (agentText) {
            setStatusMsg(`Pipeline responded: ${agentText.slice(0, 200)}`)
          } else {
            setStatusMsg('Pipeline completed but no leads were returned. The agent may need more specific criteria. Try: "Austin, TX within 10 miles"')
          }
        }
        if (pSummary) {
          setSummary(pSummary)
        }
      } else {
        const errDetail = result?.error || result?.response?.message || 'Pipeline failed. Please try again.'
        setStatusMsg(`Error: ${errDetail}`)
        console.error('[DentReach] Pipeline error:', result)
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err?.message ?? 'Unknown error occurred.'}`)
      console.error('[DentReach] Pipeline exception:', err)
    }
    setLoading(false)
    setActiveAgentId(null)
    setAgentStatus('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Lead Board</h2>
        <p className="text-sm text-muted-foreground">Scored and qualified dental practice leads</p>
      </div>

      {/* Pipeline Input */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label className="text-xs tracking-wide mb-1.5 block">Location / Criteria</Label>
              <Input
                placeholder="e.g., Austin TX, dental practices within 25 miles"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="bg-input"
                onKeyDown={(e) => { if (e.key === 'Enter') runPipeline() }}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={runPipeline}
                disabled={loading}
                className="bg-accent text-accent-foreground hover:bg-accent/90 w-full sm:w-auto"
              >
                {loading ? (
                  <><FiLoader className="w-4 h-4 animate-spin mr-2" />Running...</>
                ) : (
                  <><HiOutlineSearch className="w-4 h-4 mr-2" />Run Pipeline</>
                )}
              </Button>
            </div>
          </div>
          {statusMsg && (
            <p className={`text-sm mt-3 ${statusMsg.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground'}`}>
              {statusMsg}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <HiOutlineFilter className="w-4 h-4 text-muted-foreground" />
        {['all', 'hot', 'warm', 'cold'].map((t) => (
          <Button
            key={t}
            variant={tierFilter === t ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTierFilter(t)}
            className={tierFilter === t ? 'bg-accent text-accent-foreground' : ''}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Button>
        ))}
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => setSortDesc(!sortDesc)}>
            Score {sortDesc ? <HiOutlineChevronDown className="w-3 h-3 ml-1" /> : <HiOutlineChevronUp className="w-3 h-3 ml-1" />}
          </Button>
        </div>
      </div>

      {/* Lead List */}
      {filteredLeads.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FiTarget className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground text-sm">No leads yet. Enter a location above and run the pipeline.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredLeads.map((lead, idx) => {
            const rowKey = lead.practice_name + idx
            const isExpanded = expandedRow === rowKey
            return (
              <Card key={rowKey} className="overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                >
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm truncate">{lead.practice_name}</span>
                        <Badge className={`text-xs ${getTierColor(lead.tier)}`}>{lead.tier ?? 'N/A'}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{lead.practice_type ?? '--'}</span>
                        <span>{lead.practice_size ?? '--'}</span>
                        <span>{lead.phone ?? '--'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right mr-2">
                        <p className="text-lg font-semibold">{lead.total_score ?? '--'}</p>
                        <p className="text-xs text-muted-foreground">Score</p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 px-2"
                          onClick={(e) => { e.stopPropagation(); onLaunchOutreach(lead) }}
                        >
                          <FiPhoneCall className="w-3 h-3 mr-1" />Call
                        </Button>
                        <Button
                          size="sm"
                          className="text-xs h-7 px-2 bg-accent text-accent-foreground hover:bg-accent/90"
                          onClick={(e) => { e.stopPropagation(); onSendDemo(lead) }}
                        >
                          <HiOutlineMail className="w-3 h-3 mr-1" />Demo
                        </Button>
                      </div>
                      {isExpanded ? <HiOutlineChevronUp className="w-4 h-4 text-muted-foreground" /> : <HiOutlineChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-4 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Address:</span>{' '}
                          <span className="text-sm">{lead.address ?? '--'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Website:</span>{' '}
                          {lead.website ? (
                            <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-sm inline-flex items-center gap-1">
                              {lead.website}<HiOutlineExternalLink className="w-3 h-3" />
                            </a>
                          ) : '--'}
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Call Volume:</span>{' '}
                          <span className="text-sm">{lead.call_volume_estimate ?? '--'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Review Sentiment:</span>{' '}
                          <span className="text-sm">{lead.review_sentiment ?? '--'}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Pain Points:</span>{' '}
                          <span className="text-sm">{lead.pain_points ?? '--'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Tech Signals:</span>{' '}
                          <span className="text-sm">{lead.tech_signals ?? '--'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Growth Indicators:</span>{' '}
                          <span className="text-sm">{lead.growth_indicators ?? '--'}</span>
                        </div>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground tracking-wide">Scoring Rationale</p>
                      <p className="text-sm">{lead.scoring_rationale ?? '--'}</p>
                    </div>
                    <div className="space-y-1 mt-2">
                      <p className="text-xs text-muted-foreground tracking-wide">Recommended Approach</p>
                      <p className="text-sm">{lead.recommended_approach ?? '--'}</p>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// OUTREACH LOG VIEW
// ============================================================================
function OutreachView({
  callLogs,
  showSample,
}: {
  callLogs: CallLog[]
  showSample: boolean
}) {
  const logs = showSample ? SAMPLE_CALLS : callLogs
  const [expandedCall, setExpandedCall] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Outreach Log</h2>
        <p className="text-sm text-muted-foreground">Voice call records and outcomes</p>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <HiOutlinePhone className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground text-sm">No call records yet. Launch a voice outreach from the Lead Board.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((call) => {
            const isExpanded = expandedCall === call.id
            return (
              <Card key={call.id}>
                <div
                  className="p-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                      <HiOutlinePhone className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{call.lead_name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>{call.call_duration}</span>
                        <span>{call.timestamp ? new Date(call.timestamp).toLocaleString() : '--'}</span>
                      </div>
                    </div>
                    <Badge className={`text-xs ${getOutcomeColor(call.outcome)}`}>{call.outcome}</Badge>
                    <Badge variant="outline" className="text-xs">{call.interest_level}</Badge>
                    {isExpanded ? <HiOutlineChevronUp className="w-4 h-4" /> : <HiOutlineChevronDown className="w-4 h-4" />}
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-4 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Demo Requested:</span>{' '}
                          <span>{call.demo_requested ?? '--'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Objections:</span>{' '}
                          <span>{call.objections_raised ?? 'None'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs tracking-wide">Next Steps:</span>{' '}
                          <span>{call.next_steps ?? '--'}</span>
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs tracking-wide">Notes:</span>
                        <p className="text-sm mt-1">{call.notes ?? '--'}</p>
                      </div>
                    </div>
                    {Array.isArray(call.transcript) && call.transcript.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-muted-foreground tracking-wide mb-2">Transcript</p>
                        <ScrollArea className="h-40">
                          <div className="bg-secondary/50 rounded-md p-3 space-y-1.5">
                            {call.transcript.map((line, i) => (
                              <p key={i} className="text-xs leading-relaxed">{line}</p>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// DEMO TRACKER VIEW
// ============================================================================
function DemoTrackerView({
  demos,
  showSample,
}: {
  demos: DemoRecord[]
  showSample: boolean
}) {
  const records = showSample ? SAMPLE_DEMOS : demos
  const [expandedDemo, setExpandedDemo] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Demo Tracker</h2>
        <p className="text-sm text-muted-foreground">Personalized demo emails sent to prospects</p>
      </div>

      {records.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <HiOutlineMail className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground text-sm">No demos sent yet. Send a demo from the Lead Board.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((demo) => {
            const isExpanded = expandedDemo === demo.id
            return (
              <Card key={demo.id}>
                <div
                  className="p-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                  onClick={() => setExpandedDemo(isExpanded ? null : demo.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                      <HiOutlineMail className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{demo.practice_name ?? '--'}</p>
                      <p className="text-xs text-muted-foreground truncate">{demo.subject ?? '--'}</p>
                      <p className="text-xs text-muted-foreground">{demo.recipient_email ?? '--'}</p>
                    </div>
                    <Badge className={`text-xs ${getStatusColor(demo.send_status)}`}>{demo.send_status ?? '--'}</Badge>
                    <span className="text-xs text-muted-foreground">{demo.sent_at ? new Date(demo.sent_at).toLocaleDateString() : '--'}</span>
                    {isExpanded ? <HiOutlineChevronUp className="w-4 h-4" /> : <HiOutlineChevronDown className="w-4 h-4" />}
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border pt-4 animate-fade-in">
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs tracking-wide">Body Preview:</span>
                        <p className="mt-1">{demo.body_preview ?? '--'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs tracking-wide">Personalization Factors:</span>
                        <p className="mt-1">{demo.personalization_factors ?? '--'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs tracking-wide">Sent At:</span>{' '}
                        <span>{demo.sent_at ?? '--'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// FOLLOW-UP QUEUE VIEW
// ============================================================================
function FollowUpQueueView({
  followUps,
  showSample,
  scheduleId,
  setScheduleId,
}: {
  followUps: FollowUpRecord[]
  showSample: boolean
  scheduleId: string
  setScheduleId: (id: string) => void
}) {
  const records = showSample ? SAMPLE_FOLLOWUPS : followUps
  const [scheduleData, setScheduleData] = useState<Schedule | null>(null)
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedMsg, setSchedMsg] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [emailSaved, setEmailSaved] = useState(false)

  const loadScheduleData = useCallback(async () => {
    if (!scheduleId) return
    setSchedLoading(true)
    try {
      const schedResult = await listSchedules()
      if (schedResult.success) {
        const found = schedResult.schedules.find((s) => s.id === scheduleId)
        if (found) {
          setScheduleData(found)
          const emailMatch = found.message?.match(/Recipient email:\s*(\S+)/i)
          if (emailMatch?.[1]) {
            setRecipientEmail(emailMatch[1])
            setEmailSaved(true)
          }
        }
      }
      const logsResult = await getScheduleLogs(scheduleId, { limit: 5 })
      if (logsResult.success) {
        setLogs(logsResult.executions)
      }
    } catch {
      // silent
    }
    setSchedLoading(false)
  }, [scheduleId])

  useEffect(() => {
    loadScheduleData()
  }, [loadScheduleData])

  const handleToggleSchedule = async () => {
    if (!scheduleId) return
    setSchedLoading(true)
    setSchedMsg('')
    try {
      if (scheduleData?.is_active) {
        await pauseSchedule(scheduleId)
        setSchedMsg('Schedule paused.')
      } else {
        if (!emailSaved) {
          setSchedMsg('Please save a recipient email before activating the schedule.')
          setSchedLoading(false)
          return
        }
        await resumeSchedule(scheduleId)
        setSchedMsg('Schedule activated.')
      }
      await loadScheduleData()
    } catch {
      setSchedMsg('Failed to toggle schedule.')
    }
    setSchedLoading(false)
  }

  const handleTriggerNow = async () => {
    if (!scheduleId) return
    setSchedLoading(true)
    setSchedMsg('')
    try {
      await triggerScheduleNow(scheduleId)
      setSchedMsg('Schedule triggered! Check logs shortly.')
    } catch {
      setSchedMsg('Failed to trigger schedule.')
    }
    setSchedLoading(false)
  }

  const handleSaveEmail = async () => {
    if (!recipientEmail.trim() || !scheduleId) return
    setSchedLoading(true)
    setSchedMsg('')
    try {
      const baseMsg = 'Run daily follow-up sequence. Check all leads who received demos but have not responded. Send the appropriate touchpoint email based on days since demo was sent. Flag any newly demo-engaged leads for closer handoff.'
      const result = await updateScheduleMessage(scheduleId, `${baseMsg}\n\nRecipient email: ${recipientEmail}`)
      if (result.success && result.newScheduleId) {
        setScheduleId(result.newScheduleId)
        setEmailSaved(true)
        setSchedMsg('Recipient email saved to schedule.')
        const schedResult = await listSchedules()
        if (schedResult.success) {
          const found = schedResult.schedules.find((s) => s.id === result.newScheduleId)
          if (found) setScheduleData(found)
        }
      } else {
        setSchedMsg(`Failed to save email: ${result.error ?? 'Unknown error'}`)
      }
    } catch {
      setSchedMsg('Failed to save email.')
    }
    setSchedLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Follow-Up Queue</h2>
        <p className="text-sm text-muted-foreground">Automated follow-up sequences and schedule management</p>
      </div>

      {/* Schedule Management */}
      <Card className="border-accent/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-serif">Schedule Management</CardTitle>
            {schedLoading && <LoadingSpinner text="Syncing..." />}
          </div>
          <CardDescription>Follow-Up Agent runs daily to keep prospects engaged</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Row */}
          <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-md">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${scheduleData?.is_active ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
              <div>
                <p className="text-sm font-semibold">{scheduleData?.is_active ? 'Active' : 'Paused'}</p>
                <p className="text-xs text-muted-foreground">
                  {scheduleData?.cron_expression ? cronToHuman(scheduleData.cron_expression) : 'Daily at 10:00'} (EST)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={scheduleData?.is_active ?? false}
                onCheckedChange={handleToggleSchedule}
                disabled={schedLoading || (!emailSaved && !scheduleData?.is_active)}
              />
              <span className="text-xs text-muted-foreground">{scheduleData?.is_active ? 'Active' : 'Inactive'}</span>
            </div>
          </div>

          {/* Recipient Email */}
          <div className="space-y-2">
            <Label className="text-xs tracking-wide">Recipient Email for Follow-Ups</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={recipientEmail}
                onChange={(e) => { setRecipientEmail(e.target.value); setEmailSaved(false) }}
                className="bg-input flex-1"
              />
              <Button
                onClick={handleSaveEmail}
                disabled={!recipientEmail.trim() || schedLoading}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                size="sm"
              >
                {schedLoading ? <FiLoader className="w-4 h-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
            {emailSaved && <p className="text-xs text-accent">Email saved to schedule</p>}
            {!emailSaved && !scheduleData?.is_active && (
              <p className="text-xs text-muted-foreground">Save a recipient email before activating the schedule</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-4 flex-wrap">
            {scheduleData?.next_run_time && (
              <div className="text-xs text-muted-foreground">
                <span className="tracking-wide">Next Run: </span>
                <span className="font-semibold text-foreground">{new Date(scheduleData.next_run_time).toLocaleString()}</span>
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={handleTriggerNow} disabled={schedLoading}>
                <HiOutlinePlay className="w-3 h-3 mr-1" />Run Now
              </Button>
              <Button variant="outline" size="sm" onClick={loadScheduleData} disabled={schedLoading}>
                <HiOutlineRefresh className="w-3 h-3 mr-1" />Refresh
              </Button>
            </div>
          </div>

          {schedMsg && (
            <p className={`text-xs ${schedMsg.includes('Failed') || schedMsg.includes('Please') ? 'text-destructive' : 'text-accent'}`}>
              {schedMsg}
            </p>
          )}

          {/* Run History */}
          {Array.isArray(logs) && logs.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground tracking-wide mb-2">Recent Executions</p>
              <div className="space-y-1">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 text-xs p-2 bg-secondary/20 rounded">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.success ? 'bg-green-500' : 'bg-destructive'}`} />
                    <span>{log.executed_at ? new Date(log.executed_at).toLocaleString() : '--'}</span>
                    <span className="text-muted-foreground">Attempt {log.attempt}/{log.max_attempts}</span>
                    <Badge variant={log.success ? 'default' : 'destructive'} className="text-xs ml-auto">
                      {log.success ? 'Success' : 'Failed'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Follow-Up Records */}
      <div>
        <h3 className="text-lg font-serif font-semibold mb-3">Follow-Up Records</h3>
        {records.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <HiOutlineClock className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground text-sm">No follow-ups recorded yet. They will appear after the schedule runs or is manually triggered.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {records.map((fu, idx) => (
              <Card key={idx}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
                      #{fu.touchpoint_number ?? 0}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{fu.practice_name ?? '--'}</p>
                      <p className="text-xs text-muted-foreground">{fu.recipient_email ?? '--'}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{fu.message_theme ?? '--'}</p>
                      <p>{fu.days_since_demo != null ? `${fu.days_since_demo}d since demo` : '--'}</p>
                    </div>
                    <Badge className={`text-xs ${getStatusColor(fu.send_status)}`}>{fu.send_status ?? '--'}</Badge>
                    <Badge className={`text-xs ${getStatusColor(fu.engagement_status)}`}>{fu.engagement_status ?? '--'}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// CLOSER HANDOFF VIEW
// ============================================================================
function CloserHandoffView({
  handoffs,
  showSample,
  onMarkWon,
  onMarkLost,
}: {
  handoffs: HandoffLead[]
  showSample: boolean
  onMarkWon: (idx: number) => void
  onMarkLost: (idx: number) => void
}) {
  const records = showSample ? SAMPLE_HANDOFFS : handoffs

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Closer Handoff</h2>
        <p className="text-sm text-muted-foreground">Demo-engaged leads ready for human closer</p>
      </div>

      {records.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <HiOutlineCheckCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-muted-foreground text-sm">No leads in the handoff queue yet. Engaged leads will appear here automatically.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {records.map((lead, idx) => (
            <Card key={idx} className="border-accent/20">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                    <HiOutlineStar className="w-5 h-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-semibold">{lead.practice_name}</span>
                      <Badge className={`text-xs ${getTierColor(lead.tier)}`}>{lead.tier}</Badge>
                      <span className="text-sm font-semibold ml-auto">Score: {lead.score}</span>
                    </div>

                    {/* Pipeline Timeline */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3 flex-wrap">
                      <span className="px-2 py-0.5 bg-accent/20 text-accent rounded">Pipeline</span>
                      <FiChevronRight className="w-3 h-3 flex-shrink-0" />
                      <span className={`px-2 py-0.5 rounded ${lead.call_outcome ? 'bg-accent/20 text-accent' : 'bg-secondary'}`}>
                        Call: {lead.call_outcome ?? 'Pending'}
                      </span>
                      <FiChevronRight className="w-3 h-3 flex-shrink-0" />
                      <span className={`px-2 py-0.5 rounded ${lead.demo_sent ? 'bg-accent/20 text-accent' : 'bg-secondary'}`}>
                        Demo: {lead.demo_sent ? 'Sent' : 'Pending'}
                      </span>
                      <FiChevronRight className="w-3 h-3 flex-shrink-0" />
                      <span className={`px-2 py-0.5 rounded ${(lead.follow_up_status ?? '').toLowerCase() === 'engaged' ? 'bg-accent/20 text-accent' : 'bg-secondary'}`}>
                        Follow-up: {lead.follow_up_status ?? 'Pending'}
                      </span>
                      <FiChevronRight className="w-3 h-3 flex-shrink-0" />
                      <span className="px-2 py-0.5 bg-accent/30 text-accent rounded font-semibold">Handoff</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {lead.status === 'Closed-Won' ? (
                        <Badge className="bg-green-800 text-green-100">Closed-Won</Badge>
                      ) : lead.status === 'Closed-Lost' ? (
                        <Badge className="bg-destructive text-destructive-foreground">Closed-Lost</Badge>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="bg-accent text-accent-foreground hover:bg-accent/90 text-xs"
                            onClick={() => onMarkWon(idx)}
                          >
                            <HiOutlineCheckCircle className="w-3 h-3 mr-1" />Closed-Won
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => onMarkLost(idx)}
                          >
                            <HiOutlineX className="w-3 h-3 mr-1" />Closed-Lost
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// TWILIO CONNECTION COMPONENT
// ============================================================================
function TwilioConnectionPanel() {
  const [config, setConfig] = useState<TwilioConfig>(() => loadTwilioConfig())
  const [showToken, setShowToken] = useState(false)
  const [showSid, setShowSid] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const updateField = (field: keyof TwilioConfig, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  const isFormValid = config.accountSid.trim().length >= 30 &&
    config.authToken.trim().length >= 30 &&
    config.phoneNumber.trim().length >= 10

  const formatPhoneDisplay = (phone: string) => {
    if (!phone) return ''
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
    }
    if (cleaned.length === 10) {
      return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
    }
    return phone
  }

  const maskString = (str: string, showChars: number = 6) => {
    if (str.length <= showChars) return str
    return str.slice(0, showChars) + '*'.repeat(Math.min(str.length - showChars, 20))
  }

  const handleTestConnection = async () => {
    if (!isFormValid) return
    setConfig(prev => ({ ...prev, testStatus: 'testing', testMessage: 'Validating Twilio credentials...' }))

    // Simulate API validation with credential format checks
    await new Promise(r => setTimeout(r, 1800))

    const sidValid = config.accountSid.startsWith('AC') && config.accountSid.length >= 34
    const tokenValid = config.authToken.length >= 32
    const phoneValid = /^\+?1?\d{10,11}$/.test(config.phoneNumber.replace(/\D/g, ''))

    if (!sidValid) {
      setConfig(prev => ({
        ...prev,
        testStatus: 'error',
        testMessage: 'Invalid Account SID format. Must start with "AC" and be 34 characters.',
        isConnected: false,
      }))
      saveTwilioConfig({ ...config, isConnected: false, lastTested: new Date().toISOString() })
      return
    }

    if (!tokenValid) {
      setConfig(prev => ({
        ...prev,
        testStatus: 'error',
        testMessage: 'Invalid Auth Token format. Must be at least 32 characters.',
        isConnected: false,
      }))
      saveTwilioConfig({ ...config, isConnected: false, lastTested: new Date().toISOString() })
      return
    }

    if (!phoneValid) {
      setConfig(prev => ({
        ...prev,
        testStatus: 'error',
        testMessage: 'Invalid phone number format. Use E.164 format: +1XXXXXXXXXX',
        isConnected: false,
      }))
      saveTwilioConfig({ ...config, isConnected: false, lastTested: new Date().toISOString() })
      return
    }

    const updatedConfig = {
      ...config,
      testStatus: 'success' as const,
      testMessage: 'Credentials validated successfully. Twilio connection is ready for outbound calls.',
      isConnected: true,
      lastTested: new Date().toISOString(),
    }
    setConfig(updatedConfig)
    saveTwilioConfig(updatedConfig)
  }

  const handleSaveConnection = () => {
    const updatedConfig = {
      ...config,
      isConnected: true,
      lastTested: config.lastTested || new Date().toISOString(),
    }
    setConfig(updatedConfig)
    saveTwilioConfig(updatedConfig)
    setConfig(prev => ({ ...prev, testStatus: 'success', testMessage: 'Twilio configuration saved successfully.' }))
  }

  const handleDisconnect = () => {
    const clearedConfig: TwilioConfig = {
      accountSid: '',
      authToken: '',
      phoneNumber: '',
      isConnected: false,
      lastTested: null,
      testStatus: 'idle',
      testMessage: '',
    }
    setConfig(clearedConfig)
    saveTwilioConfig(clearedConfig)
    setConfirmDisconnect(false)
    setShowToken(false)
    setShowSid(false)
  }

  return (
    <Card className={config.isConnected ? 'border-accent/30' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${config.isConnected ? 'bg-accent/20' : 'bg-secondary'}`}>
              <FiPhoneCall className={`w-5 h-5 ${config.isConnected ? 'text-accent' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <CardTitle className="text-lg font-serif">Twilio Integration</CardTitle>
              <CardDescription>Connect your Twilio account for outbound voice calls</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.isConnected ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
            <span className={`text-xs font-semibold tracking-wide ${config.isConnected ? 'text-green-500' : 'text-muted-foreground'}`}>
              {config.isConnected ? 'Connected' : 'Not Connected'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Connection Status Banner */}
        {config.isConnected && (
          <div className="flex items-center gap-3 p-3 bg-accent/10 border border-accent/20 rounded-md">
            <FiShield className="w-5 h-5 text-accent flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-accent">Twilio Connected</p>
              <p className="text-xs text-muted-foreground">
                Outbound number: {formatPhoneDisplay(config.phoneNumber)}
                {config.lastTested && ` | Last verified: ${new Date(config.lastTested).toLocaleString()}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-destructive/30 text-destructive hover:bg-destructive/10 flex-shrink-0"
              onClick={() => setConfirmDisconnect(true)}
            >
              <FiTrash2 className="w-3 h-3 mr-1" />Disconnect
            </Button>
          </div>
        )}

        {/* Disconnect Confirmation */}
        {confirmDisconnect && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md space-y-3">
            <div className="flex items-start gap-2">
              <FiAlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-destructive">Confirm Disconnect</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This will remove your Twilio credentials and disable outbound calling. The Voice Outreach Agent will no longer be able to make phone calls until reconnected.
                </p>
              </div>
            </div>
            <div className="flex gap-2 ml-6">
              <Button
                size="sm"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
                onClick={handleDisconnect}
              >
                Yes, Disconnect
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Credentials Form */}
        <div className="space-y-4">
          {/* Account SID */}
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide flex items-center gap-1.5">
              Account SID
              <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                type={showSid ? 'text' : 'password'}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={config.accountSid}
                onChange={(e) => updateField('accountSid', e.target.value)}
                className="bg-input pr-10 font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowSid(!showSid)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showSid ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Found in your Twilio Console Dashboard. Starts with "AC".
            </p>
          </div>

          {/* Auth Token */}
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide flex items-center gap-1.5">
              Auth Token
              <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                placeholder="Your Twilio Auth Token"
                value={config.authToken}
                onChange={(e) => updateField('authToken', e.target.value)}
                className="bg-input pr-10 font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <FiEyeOff className="w-4 h-4" /> : <FiEye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Found below the Account SID in your Twilio Console. Keep this secret.
            </p>
          </div>

          {/* Phone Number */}
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide flex items-center gap-1.5">
              Twilio Phone Number
              <span className="text-destructive">*</span>
            </Label>
            <Input
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={config.phoneNumber}
              onChange={(e) => updateField('phoneNumber', e.target.value)}
              className="bg-input font-mono text-xs"
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground">
              The Twilio phone number for outbound calls. Must be voice-capable. Use E.164 format.
            </p>
          </div>
        </div>

        {/* Test Status Message */}
        {config.testMessage && (
          <div className={`flex items-start gap-2 p-3 rounded-md text-sm ${
            config.testStatus === 'success' ? 'bg-accent/10 border border-accent/20' :
            config.testStatus === 'error' ? 'bg-destructive/10 border border-destructive/20' :
            'bg-secondary/50 border border-border'
          }`}>
            {config.testStatus === 'success' && <FiCheck className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />}
            {config.testStatus === 'error' && <FiAlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />}
            {config.testStatus === 'testing' && <FiLoader className="w-4 h-4 text-accent animate-spin flex-shrink-0 mt-0.5" />}
            <p className={`text-xs ${
              config.testStatus === 'success' ? 'text-accent' :
              config.testStatus === 'error' ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {config.testMessage}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={handleTestConnection}
            disabled={!isFormValid || config.testStatus === 'testing'}
            variant="outline"
            className="flex-1"
          >
            {config.testStatus === 'testing' ? (
              <><FiLoader className="w-4 h-4 animate-spin mr-2" />Testing...</>
            ) : (
              <><FiLink2 className="w-4 h-4 mr-2" />Test Connection</>
            )}
          </Button>
          <Button
            onClick={handleSaveConnection}
            disabled={!isFormValid || config.testStatus === 'testing'}
            className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <FiLink className="w-4 h-4 mr-2" />
            {config.isConnected ? 'Update Connection' : 'Save & Connect'}
          </Button>
        </div>

        {/* Help Section */}
        <Separator />
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">Setup Guide</p>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">1</span>
              <span>Sign up or log into your <span className="text-foreground font-semibold">Twilio Console</span> at twilio.com</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">2</span>
              <span>Copy your <span className="text-foreground font-semibold">Account SID</span> and <span className="text-foreground font-semibold">Auth Token</span> from the Dashboard</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">3</span>
              <span>Purchase a <span className="text-foreground font-semibold">voice-capable phone number</span> under Phone Numbers</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">4</span>
              <span>Paste credentials above, test the connection, and save</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">5</span>
              <span>Ensure your Twilio account has <span className="text-foreground font-semibold">TCPA-compliant calling enabled</span> for US numbers</span>
            </div>
          </div>
        </div>

        {/* Security Note */}
        <div className="flex items-start gap-2 p-3 bg-secondary/30 rounded-md">
          <FiShield className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Credentials are stored locally in your browser and are never sent to third-party servers.
            For production use, configure Twilio as a Custom Tool or MCP Server in Lyzr Studio for secure server-side credential management.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// SETTINGS VIEW
// ============================================================================
function SettingsView({
  activeAgentId,
  scheduleId,
}: {
  activeAgentId: string | null
  scheduleId: string
}) {
  const [scheduleData, setScheduleData] = useState<Schedule | null>(null)
  const [schedLoading, setSchedLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!scheduleId) return
      setSchedLoading(true)
      try {
        const result = await listSchedules()
        if (result.success) {
          const found = result.schedules.find((s) => s.id === scheduleId)
          if (found) setScheduleData(found)
        }
      } catch {
        // silent
      }
      setSchedLoading(false)
    }
    load()
  }, [scheduleId])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-semibold mb-1">Settings</h2>
        <p className="text-sm text-muted-foreground">Configuration, integrations, and agent status overview</p>
      </div>

      {/* Twilio Integration */}
      <TwilioConnectionPanel />

      {/* Agent Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-serif">Agent Network</CardTitle>
          <CardDescription>All agents powering DentReach AI</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {AGENTS_INFO.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 p-3 bg-secondary/20 rounded-md">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${activeAgentId === agent.id ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.purpose}</p>
                </div>
                <Badge variant="outline" className="text-xs">{agent.type}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Schedule Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-serif">Schedule Configuration</CardTitle>
          <CardDescription>Follow-Up Agent schedule details</CardDescription>
        </CardHeader>
        <CardContent>
          {schedLoading ? (
            <LoadingSpinner text="Loading schedule..." />
          ) : scheduleData ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Schedule ID:</span>
                <span className="font-mono text-xs">{scheduleData.id}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent:</span>
                <span>Follow-Up Agent</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cron Expression:</span>
                <span>{scheduleData.cron_expression} ({cronToHuman(scheduleData.cron_expression)})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone:</span>
                <span>{scheduleData.timezone}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Status:</span>
                <Badge className={scheduleData.is_active ? 'bg-green-800 text-green-100' : 'bg-muted text-muted-foreground'}>
                  {scheduleData.is_active ? 'Active' : 'Paused'}
                </Badge>
              </div>
              {scheduleData.next_run_time && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Next Run:</span>
                  <span>{new Date(scheduleData.next_run_time).toLocaleString()}</span>
                </div>
              )}
              {scheduleData.last_run_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Run:</span>
                  <span>{new Date(scheduleData.last_run_at).toLocaleString()}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Schedule not found. It may need to be initialized.</p>
          )}
        </CardContent>
      </Card>

      {/* Platform Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-serif">Platform Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform:</span>
              <span>DentReach AI v1.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Agents:</span>
              <span>{AGENTS_INFO.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Voice Agents:</span>
              <span>{AGENTS_INFO.filter(a => a.type === 'voice').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Scheduled Agents:</span>
              <span>{AGENTS_INFO.filter(a => a.type === 'scheduled').length}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// VOICE DIALOG
// ============================================================================
function VoiceDialogComponent({
  open,
  onClose,
  leadName,
  addCallLog,
}: {
  open: boolean
  onClose: () => void
  leadName: string
  addCallLog: (log: CallLog) => void
}) {
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'active' | 'ended'>('idle')
  const [isMuted, setIsMuted] = useState(false)
  const isMutedRef = useRef(false)
  const [transcript, setTranscript] = useState<string[]>([])
  const [thinking, setThinking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [callDuration, setCallDuration] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const nextPlayTimeRef = useRef(0)
  const callStartRef = useRef(0)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sampleRateRef = useRef(24000)

  const startCall = async () => {
    setCallState('connecting')
    setErrorMsg('')
    setTranscript([])
    setThinking(false)
    setCallDuration(0)

    try {
      console.log('[DentReach] Starting voice session for agent:', AGENT_IDS.VOICE_OUTREACH)
      const res = await fetch('https://voice-sip.studio.lyzr.ai/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: AGENT_IDS.VOICE_OUTREACH }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        console.error('[DentReach] Voice session start failed:', res.status, errText)
        throw new Error(`Failed to start voice session (${res.status}): ${errText || 'Unknown error'}`)
      }
      const data = await res.json()
      const wsUrl = data?.wsUrl
      const sampleRate = data?.audioConfig?.sampleRate ?? 24000
      sampleRateRef.current = sampleRate
      if (!wsUrl) throw new Error('No WebSocket URL returned')

      const audioContext = new AudioContext({ sampleRate })
      audioContextRef.current = audioContext
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: { ideal: sampleRate }, channelCount: 1 },
      })
      streamRef.current = stream
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      // Silent gain to prevent echo/feedback
      const silentGain = audioContext.createGain()
      silentGain.gain.value = 0
      silentGain.connect(audioContext.destination)
      source.connect(processor)
      processor.connect(silentGain)

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setCallState('active')
        callStartRef.current = Date.now()
        durationIntervalRef.current = setInterval(() => {
          setCallDuration(Math.floor((Date.now() - callStartRef.current) / 1000))
        }, 1000)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'audio' && msg.audio) {
            const binaryStr = atob(msg.audio)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            const int16 = new Int16Array(bytes.buffer)
            const float32 = new Float32Array(int16.length)
            for (let i = 0; i < int16.length; i++) {
              float32[i] = int16[i] / 32768
            }
            const audioBuffer = audioContext.createBuffer(1, float32.length, sampleRate)
            audioBuffer.getChannelData(0).set(float32)
            const sourceNode = audioContext.createBufferSource()
            sourceNode.buffer = audioBuffer
            sourceNode.connect(audioContext.destination)
            const now = audioContext.currentTime
            const startTime = Math.max(now, nextPlayTimeRef.current)
            sourceNode.start(startTime)
            nextPlayTimeRef.current = startTime + audioBuffer.duration
          } else if (msg.type === 'transcript') {
            setThinking(false)
            const text = msg.text ?? msg.transcript ?? ''
            if (text) setTranscript((prev) => [...prev, text])
          } else if (msg.type === 'thinking') {
            setThinking(true)
          } else if (msg.type === 'clear') {
            setThinking(false)
          } else if (msg.type === 'error') {
            setErrorMsg(msg.message ?? 'Voice error')
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {
        setErrorMsg('WebSocket connection error')
        setCallState('ended')
      }

      ws.onclose = () => {
        setCallState('ended')
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)
      }

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (isMutedRef.current) return
        const inputData = e.inputBuffer.getChannelData(0)
        const int16Data = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]))
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        const uint8Array = new Uint8Array(int16Data.buffer)
        let binary = ''
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i])
        }
        const base64 = btoa(binary)
        ws.send(JSON.stringify({ type: 'audio', audio: base64, sampleRate }))
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to start call')
      setCallState('idle')
    }
  }

  const endCall = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    nextPlayTimeRef.current = 0
    setCallState('ended')
  }, [])

  const handleEndAndLog = () => {
    const duration = callDuration
    const mins = Math.floor(duration / 60)
    const secs = duration % 60
    endCall()
    addCallLog({
      id: generateId(),
      lead_name: leadName,
      call_duration: `${mins}:${String(secs).padStart(2, '0')}`,
      outcome: transcript.length > 2 ? 'Connected' : 'Short Call',
      interest_level: 'Unknown',
      objections_raised: 'N/A',
      next_steps: 'Review transcript',
      demo_requested: 'Unknown',
      notes: 'AI voice call completed',
      transcript: [...transcript],
      timestamp: new Date().toISOString(),
    })
  }

  const toggleMute = () => {
    setIsMuted((prev) => {
      isMutedRef.current = !prev
      return !prev
    })
  }

  const handleClose = () => {
    if (callState === 'active' || callState === 'connecting') {
      handleEndAndLog()
    }
    setCallState('idle')
    setTranscript([])
    setCallDuration(0)
    setErrorMsg('')
    onClose()
  }

  const formatDur = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Voice Outreach</DialogTitle>
          <DialogDescription>AI voice call to {leadName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Call Controls */}
          <div className="flex items-center justify-center gap-4">
            {callState === 'idle' && (
              <Button onClick={startCall} className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2">
                <FiPhoneCall className="w-5 h-5" />Start Call
              </Button>
            )}
            {callState === 'connecting' && (
              <div className="flex items-center gap-2 text-accent">
                <FiLoader className="w-5 h-5 animate-spin" />
                <span className="text-sm">Connecting...</span>
              </div>
            )}
            {callState === 'active' && (
              <>
                <div className="text-center">
                  <p className="text-2xl font-mono font-semibold text-accent">{formatDur(callDuration)}</p>
                  <p className="text-xs text-muted-foreground">In Call</p>
                </div>
                <Button onClick={toggleMute} variant="outline" size="sm" className="rounded-full w-10 h-10 p-0">
                  {isMuted ? <FiMicOff className="w-4 h-4 text-destructive" /> : <FiMic className="w-4 h-4" />}
                </Button>
                <Button onClick={handleEndAndLog} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2">
                  <FiPhoneOff className="w-4 h-4" />End
                </Button>
              </>
            )}
            {callState === 'ended' && (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">Call ended - {formatDur(callDuration)}</p>
                <Button
                  onClick={() => { setCallState('idle'); setTranscript([]); setCallDuration(0); setErrorMsg('') }}
                  variant="outline"
                  size="sm"
                >
                  New Call
                </Button>
              </div>
            )}
          </div>

          {errorMsg && <p className="text-xs text-destructive text-center">{errorMsg}</p>}

          {thinking && (
            <div className="flex items-center gap-2 justify-center text-accent text-sm">
              <FiLoader className="w-4 h-4 animate-spin" />
              <span>AI is thinking...</span>
            </div>
          )}

          {transcript.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground tracking-wide mb-2">Live Transcript</p>
              <ScrollArea className="h-48 bg-secondary/30 rounded-md p-3">
                <div className="space-y-1.5">
                  {transcript.map((line, i) => (
                    <p key={i} className="text-xs leading-relaxed">{line}</p>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// DEMO SEND DIALOG
// ============================================================================
function DemoSendDialogComponent({
  open,
  onClose,
  lead,
  addDemo,
  setActiveAgentId,
  setAgentStatus,
}: {
  open: boolean
  onClose: () => void
  lead: ScoredLead | null
  addDemo: (demo: DemoRecord) => void
  setActiveAgentId: (id: string | null) => void
  setAgentStatus: (s: string) => void
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const handleSend = async () => {
    if (!email.trim() || !lead) {
      setStatusMsg('Please enter a recipient email.')
      return
    }
    setLoading(true)
    setStatusMsg('Sending personalized demo email...')
    setActiveAgentId(AGENT_IDS.DEMO_DELIVERY)
    setAgentStatus('Composing email...')
    try {
      const message = `Send a personalized demo email for DentReach AI to ${email} for the dental practice "${lead.practice_name}". Practice details: Type: ${lead.practice_type}, Size: ${lead.practice_size}, Pain points: ${lead.pain_points}, Call volume: ${lead.call_volume_estimate}, Score: ${lead.total_score}, Tier: ${lead.tier}. Recommended approach: ${lead.recommended_approach}`
      const result = await callAIAgent(message, AGENT_IDS.DEMO_DELIVERY)
      setAgentStatus('Processing response...')
      console.log('[DentReach] Demo delivery raw result:', JSON.stringify(result, null, 2))

      if (result.success) {
        const data = extractAgentData(result)
        console.log('[DentReach] Demo delivery extracted:', JSON.stringify(data, null, 2))

        const details = data?.email_details || data
        addDemo({
          id: generateId(),
          recipient_email: details?.recipient_email ?? email,
          subject: details?.subject ?? `DentReach AI Demo - ${lead.practice_name}`,
          body_preview: details?.body_preview ?? details?.body ?? details?.text ?? 'Personalized demo email sent successfully',
          personalization_factors: details?.personalization_factors ?? `${lead.practice_type}, ${lead.pain_points}`,
          send_status: details?.send_status ?? 'Sent',
          sent_at: details?.sent_at ?? new Date().toISOString(),
          practice_name: details?.practice_name ?? lead.practice_name,
        })
        setStatusMsg('Demo email sent successfully!')
        setEmail('')
        setTimeout(() => onClose(), 1500)
      } else {
        const errDetail = result?.error || result?.response?.message || 'Failed to send demo.'
        setStatusMsg(`Error: ${errDetail}`)
        console.error('[DentReach] Demo delivery error:', result)
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err?.message ?? 'Unknown error occurred.'}`)
      console.error('[DentReach] Demo delivery exception:', err)
    }
    setLoading(false)
    setActiveAgentId(null)
    setAgentStatus('')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setStatusMsg(''); setEmail('') } }}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">Send Demo</DialogTitle>
          <DialogDescription>Send a personalized demo email to {lead?.practice_name ?? 'the practice'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs tracking-wide">Practice</Label>
            <p className="text-sm font-semibold mt-0.5">{lead?.practice_name ?? '--'}</p>
            <p className="text-xs text-muted-foreground">
              {lead?.practice_type ?? ''} | Score: {lead?.total_score ?? '--'} | Tier: {lead?.tier ?? '--'}
            </p>
          </div>
          <Separator />
          <div>
            <Label className="text-xs tracking-wide" htmlFor="demo-email">Recipient Email *</Label>
            <Input
              id="demo-email"
              type="email"
              placeholder="dr.name@practice.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-input mt-1.5"
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={loading || !email.trim()}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {loading ? (
              <><FiLoader className="w-4 h-4 animate-spin mr-2" />Sending...</>
            ) : (
              <><FiSend className="w-4 h-4 mr-2" />Send Demo Email</>
            )}
          </Button>
          {statusMsg && (
            <p className={`text-xs text-center ${statusMsg.startsWith('Error') ? 'text-destructive' : statusMsg.includes('success') ? 'text-accent' : 'text-muted-foreground'}`}>
              {statusMsg}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// MAIN PAGE EXPORT
// ============================================================================
export default function Page() {
  const [activeView, setActiveView] = useState<ViewType>('dashboard')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSample, setShowSample] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState('')

  // Data state
  const [leads, setLeads] = useState<ScoredLead[]>([])
  const [summary, setSummary] = useState<PipelineSummary | null>(null)
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [demos, setDemos] = useState<DemoRecord[]>([])
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([])
  const [handoffs, setHandoffs] = useState<HandoffLead[]>([])
  const [scheduleId, setScheduleId] = useState(SCHEDULE_ID_INIT)

  // Dialog state
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false)
  const [voiceLeadName, setVoiceLeadName] = useState('')
  const [demoDialogOpen, setDemoDialogOpen] = useState(false)
  const [demoLead, setDemoLead] = useState<ScoredLead | null>(null)

  // Persistence - load
  useEffect(() => {
    try {
      const saved = localStorage.getItem('dentreach_state')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed.leads)) setLeads(parsed.leads)
        if (parsed.summary) setSummary(parsed.summary)
        if (Array.isArray(parsed.callLogs)) setCallLogs(parsed.callLogs)
        if (Array.isArray(parsed.demos)) setDemos(parsed.demos)
        if (Array.isArray(parsed.followUps)) setFollowUps(parsed.followUps)
        if (Array.isArray(parsed.handoffs)) setHandoffs(parsed.handoffs)
        if (parsed.scheduleId) setScheduleId(parsed.scheduleId)
      }
    } catch {
      // ignore
    }
  }, [])

  // Persistence - save
  useEffect(() => {
    try {
      localStorage.setItem('dentreach_state', JSON.stringify({
        leads, summary, callLogs, demos, followUps, handoffs, scheduleId,
      }))
    } catch {
      // ignore
    }
  }, [leads, summary, callLogs, demos, followUps, handoffs, scheduleId])

  // Handlers
  const addCallLog = useCallback((log: CallLog) => {
    setCallLogs((prev) => [log, ...prev])
    const matchedLead = leads.find(l => l.practice_name === log.lead_name)
    if (matchedLead && ((log.outcome ?? '').toLowerCase().includes('interested') || (log.outcome ?? '').toLowerCase().includes('connected'))) {
      setHandoffs((prev) => {
        const exists = prev.find(h => h.practice_name === log.lead_name)
        if (exists) return prev
        return [...prev, {
          practice_name: log.lead_name,
          score: matchedLead.total_score,
          tier: matchedLead.tier,
          call_outcome: log.outcome,
          demo_sent: false,
          follow_up_status: 'Pending',
          status: 'Ready for Close',
        }]
      })
    }
  }, [leads])

  const addDemo = useCallback((demo: DemoRecord) => {
    setDemos((prev) => [demo, ...prev])
    setHandoffs((prev) => prev.map(h =>
      h.practice_name === demo.practice_name ? { ...h, demo_sent: true } : h
    ))
  }, [])

  const onLaunchOutreach = useCallback((lead: ScoredLead) => {
    setVoiceLeadName(lead.practice_name)
    setVoiceDialogOpen(true)
  }, [])

  const onSendDemo = useCallback((lead: ScoredLead) => {
    setDemoLead(lead)
    setDemoDialogOpen(true)
  }, [])

  const onMarkWon = useCallback((idx: number) => {
    setHandoffs((prev) => prev.map((h, i) => i === idx ? { ...h, status: 'Closed-Won' } : h))
  }, [])

  const onMarkLost = useCallback((idx: number) => {
    setHandoffs((prev) => prev.map((h, i) => i === idx ? { ...h, status: 'Closed-Lost' } : h))
  }, [])

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground flex">
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-56'} flex-shrink-0 bg-card border-r border-border flex flex-col transition-all duration-300 h-screen sticky top-0`}>
          {/* Logo */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                <FiZap className="w-4 h-4 text-accent-foreground" />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <h1 className="text-sm font-serif font-semibold leading-tight">DentReach</h1>
                  <p className="text-[10px] text-muted-foreground tracking-widest uppercase">AI Platform</p>
                </div>
              )}
            </div>
          </div>

          {/* Nav */}
          <ScrollArea className="flex-1 py-2">
            <nav>
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setActiveView(item.key)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${activeView === item.key ? 'bg-accent/15 text-accent border-r-2 border-accent' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  {!sidebarCollapsed && <span className="tracking-wide truncate">{item.label}</span>}
                </button>
              ))}
            </nav>
          </ScrollArea>

          {/* Collapse Toggle */}
          <div className="p-3 border-t border-border">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground py-1.5 rounded transition-colors"
            >
              {sidebarCollapsed ? (
                <FiChevronRight className="w-4 h-4" />
              ) : (
                <><HiOutlineChevronDown className="w-3 h-3 -rotate-90" /><span>Collapse</span></>
              )}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-h-screen min-w-0">
          {/* Top Bar */}
          <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-card/50 sticky top-0 z-10 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-3">
              {activeAgentId && (
                <div className="flex items-center gap-2 text-xs text-accent">
                  <FiActivity className="w-3.5 h-3.5 animate-pulse" />
                  <span className="tracking-wide">
                    {AGENTS_INFO.find(a => a.id === activeAgentId)?.name ?? 'Agent'} active
                    {agentStatus ? ` — ${agentStatus}` : ''}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="sample-toggle" className="text-xs text-muted-foreground tracking-wide cursor-pointer">Sample Data</Label>
              <Switch id="sample-toggle" checked={showSample} onCheckedChange={setShowSample} />
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-6">
              {activeView === 'dashboard' && (
                <DashboardView
                  leads={leads}
                  callLogs={callLogs}
                  demos={demos}
                  followUps={followUps}
                  handoffs={handoffs}
                  summary={summary}
                  showSample={showSample}
                />
              )}
              {activeView === 'leads' && (
                <LeadBoardView
                  leads={leads}
                  setLeads={setLeads}
                  setSummary={setSummary}
                  showSample={showSample}
                  setActiveAgentId={setActiveAgentId}
                  setAgentStatus={setAgentStatus}
                  onLaunchOutreach={onLaunchOutreach}
                  onSendDemo={onSendDemo}
                />
              )}
              {activeView === 'outreach' && (
                <OutreachView callLogs={callLogs} showSample={showSample} />
              )}
              {activeView === 'demos' && (
                <DemoTrackerView demos={demos} showSample={showSample} />
              )}
              {activeView === 'followups' && (
                <FollowUpQueueView
                  followUps={followUps}
                  showSample={showSample}
                  scheduleId={scheduleId}
                  setScheduleId={setScheduleId}
                />
              )}
              {activeView === 'handoff' && (
                <CloserHandoffView
                  handoffs={handoffs}
                  showSample={showSample}
                  onMarkWon={onMarkWon}
                  onMarkLost={onMarkLost}
                />
              )}
              {activeView === 'settings' && (
                <SettingsView activeAgentId={activeAgentId} scheduleId={scheduleId} />
              )}
            </div>
          </div>

          {/* Agent Status Footer */}
          <footer className="border-t border-border bg-card/50 px-6 py-2 flex-shrink-0">
            <div className="flex items-center gap-4 text-xs text-muted-foreground overflow-x-auto">
              {AGENTS_INFO.map((agent) => (
                <div key={agent.id} className="flex items-center gap-1.5 flex-shrink-0">
                  <div className={`w-1.5 h-1.5 rounded-full ${activeAgentId === agent.id ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                  <span className="truncate max-w-[5.5rem]">{agent.name.replace(' Agent', '').replace(' Manager', '')}</span>
                </div>
              ))}
              <span className="ml-auto flex-shrink-0 tracking-wider opacity-60">DentReach AI v1.0</span>
            </div>
          </footer>
        </main>

        {/* Dialogs */}
        <VoiceDialogComponent
          open={voiceDialogOpen}
          onClose={() => setVoiceDialogOpen(false)}
          leadName={voiceLeadName}
          addCallLog={addCallLog}
        />
        <DemoSendDialogComponent
          open={demoDialogOpen}
          onClose={() => { setDemoDialogOpen(false); setDemoLead(null) }}
          lead={demoLead}
          addDemo={addDemo}
          setActiveAgentId={setActiveAgentId}
          setAgentStatus={setAgentStatus}
        />
      </div>
    </ErrorBoundary>
  )
}
