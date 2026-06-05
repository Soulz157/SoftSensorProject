import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const ISSUES = [
  {
    id: 'i1',
    problem: 'Canvas not loading',
    solution:
      'Refresh the page. If the issue persists, check your network connection and verify the backend is reachable at the API URL. A "Loading canvas…" spinner that never resolves usually indicates a failed API request — open the browser console (F12) and look for a 401 or 5xx error.',
  },
  {
    id: 'i2',
    problem: 'Nodes not saving after edit',
    solution:
      'Confirm you clicked ✓ Confirm in the canvas toolbar after making changes. Navigating away or clicking Cancel discards unsaved edits. Ensure you are in Build Mode when editing.',
  },
  {
    id: 'i3',
    problem: 'Alert count badge not updating',
    solution:
      'The badge count is derived from node statuses loaded at login. Refresh the page to force a re-fetch of workspace data. If a node status changed after you logged in, the badge reflects the cached value until the next load.',
  },
  {
    id: 'i4',
    problem: 'Cannot create a workspace',
    solution:
      'Workspace creation requires an authenticated session. Ensure you are logged in. If the + New Workspace button is missing, your account may lack the necessary role — contact your administrator.',
  },
]

export function SectionTroubleshooting() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">
        Troubleshooting
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Step-by-step fixes for common issues.
      </p>
      <Accordion type="single" collapsible className="flex flex-col gap-2">
        {ISSUES.map(item => (
          <AccordionItem
            key={item.id}
            value={item.id}
            className="bg-card border border-border rounded-xl px-4"
          >
            <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
              {item.problem}
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground pb-4">
              {item.solution}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
