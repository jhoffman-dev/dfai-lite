import { Menu } from '@base-ui/react/menu';
import type { Editor } from '@tiptap/core';
import { kindAfterChange, offeredCallouts, resolveCallout } from '../../application/index.ts';
import type { CalloutSettings, CalloutType } from '../../domain/callouts/index.ts';
import { Icon } from '../shell/icons.tsx';
import type { BlockTarget } from './block-actions.ts';
import { dispatchBlockChange } from './block-handle.ts';
import {
  calloutAround,
  canTurnIntoCallout,
  setCalloutKind,
  unwrapCallout,
  wrapInCallout,
} from './callout-actions.ts';
import type { CalloutCatalog } from './callout.ts';

/** The vault's callout types the editor was built with. */
export function calloutCatalogOf(editor: Editor): CalloutCatalog | null {
  const extension = editor.extensionManager.extensions.find((each) => each.name === 'callout');
  return (extension?.options as { catalog?: CalloutCatalog } | undefined)?.catalog ?? null;
}

/** A type as a menu row shows it: its badge in its hue, then its label. */
export function CalloutTypeBadge({ type }: { type: Pick<CalloutType, 'hue' | 'icon'> }) {
  return (
    <span className="callout-swatch" data-hue={type.hue} aria-hidden="true">
      <Icon name={type.icon} size={13} />
    </span>
  );
}

/** What the block's menu offers for callouts, or null for a block it has nothing for. */
function calloutChoices(editor: Editor, target: BlockTarget, settings: CalloutSettings) {
  const callout = calloutAround(editor.state, target);
  if (callout !== null) {
    const kind = String(callout.node.attrs['kind'] ?? 'note');
    return {
      kind: 'callout' as const,
      callout,
      current: resolveCallout(kind, settings).key,
      kindNow: kind,
    };
  }
  return canTurnIntoCallout(editor.state, target) ? { kind: 'block' as const } : null;
}

/**
 * The callout rows at the top of a block's menu, as Notion's: on a callout,
 * "Callout type" (every type, the current one checked) and "Remove
 * callout"; on another block of the note, "Turn into callout". The types
 * are a Base UI submenu: an arrow opens it, typing finds a type, Escape
 * goes back.
 */
export function CalloutMenuSection({ editor, target }: { editor: Editor; target: BlockTarget }) {
  const settings = calloutCatalogOf(editor)?.settings() ?? { types: [], hidden: [] };
  const choices = calloutChoices(editor, target, settings);
  if (choices === null) return null;
  const view = editor.view;
  const picked = (type: CalloutType) => {
    if (choices.kind === 'callout') {
      const kind = kindAfterChange(choices.kindNow, type, settings);
      dispatchBlockChange(view, setCalloutKind(view.state, { callout: choices.callout, kind }));
    } else {
      dispatchBlockChange(view, wrapInCallout(view.state, { target, kind: type.name }));
    }
  };
  const offered = offeredCallouts(settings);
  const current = choices.kind === 'callout' ? choices.current : null;
  // A hidden type is still listed on a callout of it, so the menu says what it is.
  const types =
    current !== null && !offered.some((type) => type.name.toLowerCase() === current)
      ? [...offered, resolvedAsType(choices.kind === 'callout' ? choices.kindNow : '', settings)]
      : offered;
  return (
    <>
      <li>
        <TypeSubmenu
          label={choices.kind === 'callout' ? 'Callout type' : 'Turn into callout'}
          types={types}
          current={current}
          onPick={picked}
        />
      </li>
      {choices.kind === 'callout' ? (
        <li>
          <Menu.Item
            nativeButton
            render={<button type="button" />}
            onClick={() => {
              dispatchBlockChange(view, unwrapCallout(view.state, { callout: choices.callout }));
            }}
          >
            <span className="menu__label">Remove callout</span>
          </Menu.Item>
        </li>
      ) : null}
      <li className="menu__divider" role="separator" />
    </>
  );
}

function resolvedAsType(kind: string, settings: CalloutSettings): CalloutType {
  const { key, label, hue, icon } = resolveCallout(kind, settings);
  return { name: key, label, hue, icon };
}

function TypeSubmenu({
  label,
  types,
  current,
  onPick,
}: {
  label: string;
  types: readonly CalloutType[];
  current: string | null;
  onPick: (type: CalloutType) => void;
}) {
  const settings = { types, hidden: [] };
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger nativeButton render={<button type="button" />}>
        <span className="menu__label">{label}</span>
        <span className="menu__more" aria-hidden="true">
          <Icon name="chevron" size={13} />
        </span>
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" side="right" align="start" sideOffset={4}>
          <Menu.Popup className="menu menu--callout-types" aria-label={label}>
            <Menu.RadioGroup value={current ?? ''}>
              {types.map((type) => {
                const shown = resolveCallout(type.name, settings);
                return (
                  <Menu.RadioItem
                    key={type.name}
                    value={type.name.toLowerCase()}
                    label={shown.label}
                    nativeButton
                    render={<button type="button" />}
                    closeOnClick
                    onClick={() => onPick(type)}
                  >
                    <CalloutTypeBadge type={type} />
                    <span className="menu__label">{shown.label}</span>
                    <Menu.RadioItemIndicator className="menu__check">
                      <Icon name="check" size={13} />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                );
              })}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
