import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import type {
  DevnxControlAccount,
  DevnxControlProvider,
  DevnxControlUsageWindow
} from '../../../../shared/devnx-control-types'

export const DEVNX_PROVIDER_LABELS: Record<DevnxControlProvider, string> = {
  claude: 'Claude',
  openai: 'Codex',
  gemini: 'Antigravity'
}

function usageText(window: DevnxControlUsageWindow): string {
  return window.percent === null ? '—' : `${Math.round(window.percent)}%`
}

type Props = {
  accounts: DevnxControlAccount[]
  busyAccountId: string | null
  onSelect: (account: DevnxControlAccount) => void
}

export function DevnxControlAccountsTable({
  accounts,
  busyAccountId,
  onSelect
}: Props): React.JSX.Element {
  if (accounts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('devnx.accounts.empty', 'No accounts registered in the panel for this company.')}
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">
              {translate('devnx.accounts.provider', 'Platform')}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate('devnx.accounts.account', 'Account')}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate('devnx.accounts.status', 'Status')}
            </th>
            <th className="px-3 py-2 text-right font-medium">5h</th>
            <th className="px-3 py-2 text-right font-medium">
              {translate('devnx.accounts.weekly', 'Week')}
            </th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={`${account.provider}:${account.id}`} className="border-t border-border/40">
              <td className="px-3 py-2">{DEVNX_PROVIDER_LABELS[account.provider]}</td>
              <td className="max-w-56 truncate px-3 py-2">
                {account.label}
                {account.plan ? (
                  <span className="text-muted-foreground"> · {account.plan}</span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {account.selected ? (
                  <Badge variant="secondary">{translate('devnx.accounts.inUse', 'In use')}</Badge>
                ) : (
                  <span className="text-muted-foreground">{account.status}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{usageText(account.fiveHour)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{usageText(account.weekly)}</td>
              <td className="px-3 py-2 text-right">
                {account.selected ? null : (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busyAccountId !== null}
                    onClick={() => onSelect(account)}
                  >
                    {busyAccountId === account.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : null}
                    {translate('devnx.accounts.use', 'Use')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
