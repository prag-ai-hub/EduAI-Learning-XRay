/**
 * The app chrome: the sidebar, the top bar and the phone's bottom nav.
 *
 * Ported from the `.sidebar`, `.topbar` and `.mobile-nav` markup inside
 * `WorkspaceApp` in frontend/app/ui/FunctionalEduAIApp.tsx (~337-376).
 *
 * The three were inline in the shell there. They are components here because
 * the shell that will own the workspace state lands in a later wave, and it
 * should assemble chrome rather than contain it. Nothing below holds state:
 * every value is a prop, so the shell remains the single source of the current
 * module, the sync status and the theme.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * All three visibility rules stay in the stylesheet, where the CSS put them:
 * `sidebar` and `crumb` are `display: none` below 760px, and `mobileNav` and
 * `mobileBrand` are `display: none` above it. So all three always render and
 * the layout bucket decides what is seen - no component has to branch on the
 * window width, and none of them can disagree about where the breakpoint is.
 *
 * `SyncIndicator`'s Conflict state is deliberately untinted (see
 * `@/shared/components/status`) and its recovery is the caller's: the web did
 * `location.reload()`, which does not exist on a device, so `onReload` is a
 * prop.
 *
 * The mobile nav's `env(safe-area-inset-bottom)` padding is not applied here -
 * the shell that renders it inside a SafeAreaView owns the inset, as the
 * CAVEATS block in styles.ts records.
 */

import { Pressable, Text, View } from 'react-native';

import { icon, teacherNav } from '@/features/workspace/lib/demo-state';
import { BrandShield } from '@/shared/components/brand';
import { AppButton, IconButton } from '@/shared/components/buttons';
import {
  CreditBadge,
  RoleBadge,
  SyncIndicator,
  type SyncStatus,
} from '@/shared/components/status';
import { useAppStyles } from '@/shared/theme/styles';
import type {
  AdminModule,
  CreditSummary,
  DemoProfile,
  Role,
  TeacherModule,
} from '@/shared/types/workspace';

/** Anything the nav can point at. The two module unions overlap; that is fine. */
export type NavModule = TeacherModule | AdminModule;

const SCHOOL_ADMIN_NAV: readonly AdminModule[] = [
  'Overview',
  'Users',
  'Schools & Classes',
  'Students',
  'Academic years',
  'Branding & Privacy',
  // After the monolith's seven, so the phone's bottom bar - the first five -
  // is unchanged. Billing is a desk task, not a daily one.
  'Billing',
  'Reports',
];

const PLATFORM_NAV: readonly AdminModule[] = [
  'Overview',
  'Schools',
  'Users',
  'Analytics',
  'AI Configuration',
  'Feature flags',
  'System health',
  'Audit',
];

const FALLBACK_NAV: readonly AdminModule[] = ['Overview', 'Reports'];

/**
 * The modules a role may open.
 *
 * The legacy spellings ("School admin", "Platform admin") are matched alongside
 * the canonical ones because `Role` still carries them - a profile restored
 * from an older workspace blob would otherwise fall through to the two-item
 * fallback and lose most of its navigation.
 */
export function navFor(role: Role): readonly NavModule[] {
  if (role === 'Teacher') return teacherNav;
  if (role === 'SchoolAdmin' || role === 'School admin') return SCHOOL_ADMIN_NAV;
  if (role === 'SuperAdmin' || role === 'Platform admin') return PLATFORM_NAV;
  return FALLBACK_NAV;
}

/** "Priya Raghavan" -> "PR". Unchanged from the shell's own initials block. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export type SidebarProps = {
  profile: DemoProfile;
  module: NavModule;
  nav: readonly NavModule[];
  onModule: (next: NavModule) => void;
  /** The brand button returns to the role's first module. */
  onBrand: () => void;
  /** `.sidebar nav em` on Review - answers still awaiting a teacher. */
  reviewCount: number;
  onActivity: () => void;
  onProfile: () => void;
};

export function Sidebar({
  profile,
  module,
  nav,
  onModule,
  onBrand,
  reviewCount,
  onActivity,
  onProfile,
}: SidebarProps) {
  const s = useAppStyles();
  return (
    <View style={s.sidebar}>
      <Pressable
        role="button"
        accessibilityLabel="Learning X-Ray by EduAI Hub"
        onPress={onBrand}
        style={s.brand}>
        <BrandShield style={s.brandLogo} />
        <View>
          <Text style={s.brandName}>Learning X-Ray</Text>
          <Text style={s.brandTagline}>by EduAI Hub</Text>
        </View>
      </Pressable>

      <View style={s.sidebarNav} accessibilityLabel="Primary navigation">
        {nav.map((item) => {
          const active = module === item;
          return (
            <Pressable
              key={item}
              role="button"
              accessibilityState={{ selected: active }}
              onPress={() => onModule(item)}
              style={({ hovered, pressed }) => [
                s.navButton,
                (active || hovered || pressed) && s.navButtonActive,
              ]}>
              <Text style={s.navIcon} accessibilityElementsHidden>
                {icon(item)}
              </Text>
              <Text style={[s.navButtonLabel, active && s.navButtonLabelActive]}>{item}</Text>
              {item === 'Review' ? (
                <View style={s.navBadge}>
                  <Text style={s.navBadgeText}>{reviewCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={s.sidebarFoot}>
        <AppButton title="Activity & audit" full onPress={onActivity} />
        <Pressable
          role="button"
          accessibilityLabel={`${profile.name}, ${profile.school}. Open profile`}
          onPress={onProfile}
          style={s.profile}>
          <View style={s.profileAvatar}>
            <Text style={s.profileAvatarText}>{initialsOf(profile.name)}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.profileName}>{profile.name}</Text>
            <Text style={s.profileCaption}>{profile.school}</Text>
          </View>
          <Text style={s.profileChevron}>•••</Text>
        </Pressable>
      </View>
    </View>
  );
}

export type TopbarProps = {
  profile: DemoProfile;
  role: Role;
  syncStatus: SyncStatus;
  /** What "Changed elsewhere · reload" does - `location.reload()` on the web. */
  onReload: () => void;
  credits: CreditSummary;
  /** `state.events.length`; the badge itself is capped at 9, as it was. */
  notifications: number;
  onNotifications: () => void;
  onSignOut: () => void;
  /** The resolved appearance, which is what decides the glyph. */
  dark: boolean;
  onToggleTheme: () => void;
};

export function Topbar({
  profile,
  role,
  syncStatus,
  onReload,
  credits,
  notifications,
  onNotifications,
  onSignOut,
  dark,
  onToggleTheme,
}: TopbarProps) {
  const s = useAppStyles();
  return (
    <View style={s.topbar}>
      <View style={s.mobileBrand}>
        <BrandShield style={s.mobileBrandLogo} />
        <Text style={s.brandName}>Learning X-Ray</Text>
      </View>

      <View style={s.crumb}>
        <Text style={s.crumbText}>{profile.school}</Text>
        <Text style={s.crumbText}>›</Text>
        <Text style={s.crumbCurrent}>{role} workspace</Text>
      </View>

      <View style={s.topActions}>
        <SyncIndicator status={syncStatus} onReload={onReload} />
        <CreditBadge
          total={credits.total}
          used={credits.used}
          remaining={credits.remaining}
        />
        <RoleBadge label={profile.label} />
        <Pressable
          role="button"
          accessibilityLabel="Log out"
          onPress={onSignOut}
          style={({ hovered, pressed }) => [
            s.topActionButton,
            s.demoSignout,
            (hovered || pressed) && s.rowButtonHover,
          ]}>
          <Text style={s.demoSignoutText}>Log out</Text>
        </Pressable>
        <IconButton
          glyph={dark ? '☀' : '☾'}
          accessibilityLabel="Toggle appearance"
          onPress={onToggleTheme}
        />
        <IconButton
          glyph="♢"
          accessibilityLabel="Notifications"
          badge={notifications > 0 ? Math.min(9, notifications) : undefined}
          onPress={onNotifications}
        />
      </View>
    </View>
  );
}

export type MobileNavProps = {
  module: NavModule;
  nav: readonly NavModule[];
  onModule: (next: NavModule) => void;
  /**
   * The device's bottom safe-area inset - the CSS's `env(safe-area-inset-bottom)`.
   * Passed in rather than read here so this stays a pure view: the shell already
   * holds the insets for the rest of the screen.
   */
  bottomInset?: number;
};

/** `.mobile-nav` - the first five modules, as a bottom bar below 760px. */
export function MobileNav({ module, nav, onModule, bottomInset = 0 }: MobileNavProps) {
  const s = useAppStyles();
  return (
    <View
      style={[s.mobileNav, bottomInset > 0 && { paddingBottom: s.mobileNav.paddingBottom + bottomInset }]}
      accessibilityLabel="Primary navigation">
      {nav.slice(0, 5).map((item) => {
        const active = module === item;
        return (
          <Pressable
            key={item}
            role="button"
            accessibilityState={{ selected: active }}
            onPress={() => onModule(item)}
            style={s.mobileNavButton}>
            <Text style={s.mobileNavIcon} accessibilityElementsHidden>
              {icon(item)}
            </Text>
            <Text style={[s.mobileNavLabel, active && s.mobileNavLabelActive]}>{item}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
