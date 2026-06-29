import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, TriangleAlert, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SidebarLogic } from '@/hooks/layout/use-sidebar'
import { NavItem } from '../types'

function CollapsedNavDropdown({
  icon,
  name,
  items,
  isActiveNav,
  onClose,
  active,
}: {
  icon: ReactNode
  name: string
  items: NavItem[]
  isActiveNav: (href: string) => boolean
  onClose: () => void
  active: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={name}
          className={cn(
            'flex w-full items-center justify-center rounded-md p-2.5 text-sm font-medium transition-all',
            active
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          )}
        >
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className="min-w-44"
      >
        <DropdownMenuLabel>{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map(child => (
          <DropdownMenuItem key={child.id} asChild>
            <Link
              href={child.href!}
              onClick={onClose}
              className={cn(
                'flex cursor-pointer items-center gap-2.5',
                child.href &&
                  isActiveNav(child.href) &&
                  'bg-sidebar-accent text-sidebar-accent-foreground',
              )}
            >
              {child.icon}
              <span className="truncate">{child.name}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SidebarNavProps {
  items: NavItem[]
  isCollapsed: boolean
  logic: SidebarLogic
  onClose: () => void
  title?: string
}

export function SidebarNav({
  items,
  isCollapsed,
  logic,
  onClose,
  title,
}: SidebarNavProps) {
  const { openMenus, toggleMenu, isAnyChildActive, isActiveNav, pathname } =
    logic

  const renderItem = (item: NavItem) => {
    const isDropdown = !!item.children?.length
    const menuOpen = openMenus[item.id] ?? false
    const isAlerting = item.id === 'alerts' && (item.badge ?? 0) > 0

    if (isDropdown) {
      const childActive = isAnyChildActive(item.children!)

      if (isCollapsed) {
        return (
          <CollapsedNavDropdown
            key={item.id}
            icon={item.icon}
            name={item.name}
            items={item.children!}
            isActiveNav={isActiveNav}
            onClose={onClose}
            active={childActive}
          />
        )
      }

      const highlighted = childActive || menuOpen

      return (
        <div key={item.id}>
          <button
            onClick={() => !isCollapsed && toggleMenu(item.id)}
            title={isCollapsed ? item.name : undefined}
            className={cn(
              'flex w-full items-center rounded-md text-sm font-medium transition-all',
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
              childActive
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : highlighted
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            )}
          >
            {item.icon}
            {!isCollapsed && (
              <>
                <span className="flex-1 truncate text-left">{item.name}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    menuOpen && 'rotate-180',
                  )}
                />
              </>
            )}
          </button>

          {!isCollapsed && menuOpen && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
              {item.children!.map(child => {
                const active = child.href ? isActiveNav(child.href) : false
                return (
                  <Link
                    key={child.id}
                    href={child.href!}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                      active
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    )}
                  >
                    {child.icon}
                    <span className="truncate">{child.name}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    const isActive = item.href ? isActiveNav(item.href) : false
    return (
      <Link
        key={item.id}
        href={item.href!}
        onClick={onClose}
        title={isCollapsed ? item.name : undefined}
        className={cn(
          'flex w-full items-center rounded-md text-sm font-medium transition-all',
          isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
          isAlerting && !isActive
            ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20'
            : isActive
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        )}
      >
        {item.icon}
        {!isCollapsed && (
          <>
            <span className="truncate">{item.name}</span>
            {item.badge !== undefined && (
              <span
                className={cn(
                  'ml-auto flex items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                  isAlerting
                    ? 'bg-red-100 text-red-600 dark:border dark:border-red-500/20 dark:bg-red-500/15 dark:text-red-400'
                    : isActive
                      ? 'bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground'
                      : 'bg-primary/10 text-primary dark:bg-primary/20',
                )}
              >
                <TriangleAlert className="h-3.5 w-3.5 animate-pulse" />
                {item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    )
  }

  if (title) {
    if (isCollapsed) {
      return (
        <>
          <div className="mx-2 border-t border-sidebar-border" />
          <div className="px-2 py-3">
            <CollapsedNavDropdown
              icon={<ShieldAlert className="h-4 w-4 shrink-0" />}
              name={title}
              items={items}
              isActiveNav={isActiveNav}
              onClose={onClose}
              active={pathname.startsWith('/admin')}
            />
          </div>
        </>
      )
    }

    return (
      <>
        <div
          className={cn(
            'border-t border-sidebar-border',
            isCollapsed ? 'mx-2' : 'mx-3',
          )}
        />
        <div className={cn('py-3', isCollapsed ? 'px-2' : 'px-3')}>
          <button
            onClick={() => !isCollapsed && toggleMenu('admin')}
            title={isCollapsed ? title : undefined}
            className={cn(
              'flex w-full items-center rounded-md text-sm font-medium transition-all',
              isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
              pathname.startsWith('/admin')
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            )}
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            {!isCollapsed && (
              <>
                <span className="flex-1 text-left">{title}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform duration-200',
                    openMenus.admin && 'rotate-180',
                  )}
                />
              </>
            )}
          </button>
          {!isCollapsed && openMenus.admin && (
            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
              {items.map(item => renderItem(item))}
            </div>
          )}
        </div>
      </>
    )
  }

  // สำหรับเมนูปกติ (User)
  return (
    <nav
      className={cn(
        'flex-1 overflow-y-auto py-4',
        isCollapsed ? 'px-2' : 'px-3',
      )}
    >
      <div className="space-y-1">{items.map(item => renderItem(item))}</div>
    </nav>
  )
}
