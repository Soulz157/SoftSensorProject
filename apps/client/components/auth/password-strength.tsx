import { Check } from 'lucide-react'
import {
  checkPassword,
  STRICT_RULE_IDS,
  type PasswordRuleId,
} from '@/lib/password-rules'
import { cn } from '@/lib/utils'

/** Rule checklist with a segment per rule. Muted until met, then signal
 *  blue — never amber/green, which are reserved for plant status. */
export function PasswordStrength({
  password,
  ruleIds = STRICT_RULE_IDS,
  id,
}: {
  password: string
  ruleIds?: readonly PasswordRuleId[]
  id?: string
}) {
  const checks = checkPassword(password, ruleIds)
  const met = checks.filter(c => c.met).length
  return (
    <div id={id} className="space-y-2">
      <div className="flex gap-1" aria-hidden>
        {checks.map(c => (
          <span
            key={c.id}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              c.met ? 'bg-primary' : 'bg-muted',
            )}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {checks.map(c => (
          <li
            key={c.id}
            className={cn(
              'flex items-center gap-1.5',
              c.met ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <Check
              className={cn('size-3.5', c.met ? 'text-primary' : 'opacity-30')}
              aria-hidden
            />
            {c.label}
            <span className="sr-only">{c.met ? '(met)' : '(not met)'}</span>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {met} of {checks.length} password rules met
      </p>
    </div>
  )
}
