import { useState, useRef } from 'react'
import Link from 'next/link'
import { Search, ExternalLink } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { searchSuggestions } from '../config'

export function NavbarSearch() {
  const [searchQuery, setSearchQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredResults =
    searchQuery.length > 0
      ? {
          workspaces: searchSuggestions.workspaces.filter(w =>
            w.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
          models: searchSuggestions.models.filter(m =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
          nodes: searchSuggestions.nodes.filter(n =>
            n.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }
      : searchSuggestions

  const hasResults =
    filteredResults.workspaces.length > 0 ||
    filteredResults.models.length > 0 ||
    filteredResults.nodes.length > 0

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div ref={searchRef} className="relative w-full max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search workspaces, models, nodes..."
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value)
              setShowResults(true)
            }}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)} // Delay for clicks
            className={cn(
              'h-9 w-full bg-secondary/50 pl-9 pr-20 text-sm placeholder:text-muted-foreground',
              'focus:bg-secondary focus:ring-1 focus:ring-primary/50 transition-all duration-200',
            )}
          />
        </div>

        {showResults && (
          <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-lg z-50">
            {!hasResults && searchQuery ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No results found for &quot;{searchQuery}&quot;
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {/* Workspaces Section */}
                {filteredResults.workspaces.length > 0 && (
                  <div className="border-b border-border p-2">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      Workspaces
                    </div>
                    {filteredResults.workspaces.map(item => (
                      <Link
                        key={item.id}
                        href={`/workspaces/${item.id}`}
                        className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
                        onClick={() => setShowResults(false)}
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <span className="text-xs font-semibold">
                            {item.name.substring(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm">{item.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {/* Models Section */}
                {filteredResults.models.length > 0 && (
                  <div className="border-b border-border p-2">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      Models
                    </div>
                    {filteredResults.models.map(item => (
                      <Link
                        key={item.id}
                        href="/models"
                        className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                        onClick={() => setShowResults(false)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
                            <span className="text-xs font-semibold">AI</span>
                          </div>
                          <div>
                            <div className="text-sm">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.workspace}
                            </div>
                          </div>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                )}
                {/* Nodes Section */}
                {filteredResults.nodes.length > 0 && (
                  <div className="p-2">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      Nodes
                    </div>
                    {filteredResults.nodes.map(item => (
                      <Link
                        key={item.id}
                        href={`/workspaces/1`}
                        className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                        onClick={() => setShowResults(false)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
                            <span className="text-xs font-semibold">N</span>
                          </div>
                          <div>
                            <div className="text-sm">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.workspace}
                            </div>
                          </div>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="border-t border-border bg-muted/50 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Type to search across all resources</span>
                <span>ESC to close</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
