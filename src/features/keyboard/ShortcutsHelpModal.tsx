import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ACTION_GROUPS, ACTION_LABELS } from "./default-keybindings";
import type { ShortcutRegistry } from "./shortcut-registry";

type Props = {
  open: boolean;
  onClose: () => void;
  registry: ShortcutRegistry;
};

export function ShortcutsHelpModal({ open, onClose, registry }: Props) {
  const displayMap = useMemo(
    () => Object.fromEntries(registry.list().map((s) => [s.action, s.displayKey])),
    [registry],
  );

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="shell-modal-overlay" />
        <Dialog.Content
          className="shell-modal shell-shortcuts-modal"
          aria-label="Keyboard shortcuts"
          aria-describedby={undefined}
        >
          <Dialog.Title className="shell-shortcuts-modal__title">
            Keyboard Shortcuts
          </Dialog.Title>
          <div className="shell-shortcuts-modal__groups">
            {ACTION_GROUPS.map((group) => (
              <div key={group.label} className="shell-shortcuts-modal__group">
                <h3 className="shell-shortcuts-modal__group-label">{group.label}</h3>
                <table className="shell-shortcuts-modal__table">
                  <tbody>
                    {group.actions.map((action) => (
                      <tr key={action}>
                        <td className="shell-shortcuts-modal__action-label">
                          {ACTION_LABELS[action] ?? action}
                        </td>
                        <td className="shell-shortcuts-modal__key">
                          {displayMap[action] ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <Dialog.Close
            className="shell-shortcuts-modal__close"
            aria-label="Close shortcuts"
          >
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
