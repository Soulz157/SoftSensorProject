import { Zap, Star, Sparkles, Building2 } from 'lucide-react'
import type { PlanInfo } from '@/types'

export type PlanKey = 'FREE' | 'STANDARD' | 'PRO' | 'ENTERPRISE'

export interface PlanFeature {
  label: string
  FREE: string | boolean
  STANDARD: string | boolean
  PRO: string | boolean
  ENTERPRISE: string | boolean
}

export const STATIC_PLANS: PlanInfo[] = [
  {
    id: 'plan_free',
    name: 'FREE',
    price: 0,
    maxWorkspaces: 1,
    durationMonths: 1,
  },
  {
    id: 'plan_standard',
    name: 'STANDARD',
    price: 49,
    maxWorkspaces: 5,
    durationMonths: 1,
  },
  {
    id: 'plan_pro',
    name: 'PRO',
    price: 99,
    maxWorkspaces: 10,
    durationMonths: 1,
  },
  {
    id: 'plan_enterprise',
    name: 'ENTERPRISE',
    price: null,
    maxWorkspaces: 20,
    durationMonths: 1,
  },
]

export const FEATURES: PlanFeature[] = [
  {
    label: 'Active Models',
    FREE: 'Up to 5',
    STANDARD: 'Up to 10',
    PRO: 'Up to 20',
    ENTERPRISE: 'Unlimited',
  },
  {
    label: 'Data History',
    FREE: '7 days',
    STANDARD: '30 days',
    PRO: '90 days',
    ENTERPRISE: 'Unlimited',
  },
  {
    label: 'Custom Import',
    FREE: false,
    STANDARD: false,
    PRO: true,
    ENTERPRISE: true,
  },
  {
    label: 'API Access',
    FREE: false,
    STANDARD: false,
    PRO: true,
    ENTERPRISE: true,
  },
  {
    label: 'Team Members',
    FREE: 'Up to 5',
    STANDARD: 'Up to 10',
    PRO: 'Up to 20',
    ENTERPRISE: 'Unlimited',
  },
  {
    label: 'Priority Support',
    FREE: false,
    STANDARD: 'Email',
    PRO: 'Email',
    ENTERPRISE: 'Dedicated',
  },
  {
    label: 'Analytics Export',
    FREE: false,
    STANDARD: true,
    PRO: true,
    ENTERPRISE: true,
  },
  {
    label: 'SSO / SAML',
    FREE: false,
    STANDARD: false,
    PRO: false,
    ENTERPRISE: true,
  },
]

export const PLAN_META: Record<
  PlanKey,
  {
    icon: React.ElementType // เปลี่ยนเป็น ElementType เพื่อให้เรียกใช้เป็น Component ได้
    description: string
    badge?: string
    highlighted: boolean
    cta: string
    ctaVariant: 'outline' | 'default' | 'secondary'
  }
> = {
  FREE: {
    icon: Zap,
    description: 'For individuals exploring soft sensor modeling',
    highlighted: false,
    cta: 'Current Plan',
    ctaVariant: 'outline',
  },
  STANDARD: {
    icon: Star,
    description: 'For small teams managing multiple sensor pipelines',
    badge: 'Most Popular',
    highlighted: true,
    cta: 'Upgrade to Standard',
    ctaVariant: 'default',
  },
  PRO: {
    icon: Sparkles,
    description: 'For teams running production sensor pipelines',
    highlighted: false,
    cta: 'Upgrade to Pro',
    ctaVariant: 'default',
  },
  ENTERPRISE: {
    icon: Building2,
    description: 'Unlimited scale with dedicated support',
    highlighted: false,
    cta: 'Contact Sales',
    ctaVariant: 'secondary',
  },
}

export function formatPrice(plan: PlanInfo) {
  if (plan.price === null) return 'Custom'
  if (plan.price === 0) return '$0'
  return `$${plan.price}`
}

export function formatPeriod(plan: PlanInfo) {
  if (plan.price === null) return 'contact us'
  if (plan.price === 0) return 'per month'
  return 'per month'
}
