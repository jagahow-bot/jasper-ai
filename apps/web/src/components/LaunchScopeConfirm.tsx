"use client";

type Props = {
  title: string;
  hint: string;
  groupsLabel: string;
  groupsValue: string;
  anchorLabel: string;
  anchorValue: string;
  nameLabel: string;
  nameValue: string;
  confirmLabel: string;
  editLabel: string;
  onConfirm: () => void;
  onEdit: () => void;
};

/** Compact handoff card when RM arrives from the client dashboard with prefilled scope. */
export function LaunchScopeConfirm({
  title,
  hint,
  groupsLabel,
  groupsValue,
  anchorLabel,
  anchorValue,
  nameLabel,
  nameValue,
  confirmLabel,
  editLabel,
  onConfirm,
  onEdit,
}: Props) {
  return (
    <section className="pixel-panel space-y-4 border-[var(--primary)]/30">
      <div>
        <h2 className="ui-panel-title">{title}</h2>
        <p className="mt-1 ui-hint">{hint}</p>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="ui-hint">{groupsLabel}</dt>
          <dd className="mt-0.5 font-medium text-[var(--foreground)]">
            {groupsValue}
          </dd>
        </div>
        <div>
          <dt className="ui-hint">{anchorLabel}</dt>
          <dd className="mt-0.5 font-medium text-[var(--foreground)]">
            {anchorValue}
          </dd>
        </div>
        <div>
          <dt className="ui-hint">{nameLabel}</dt>
          <dd className="mt-0.5 font-medium text-[var(--foreground)]">
            {nameValue || "—"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="pixel-btn px-4 py-2" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button
          type="button"
          className="pixel-btn border border-[var(--border)] bg-white px-4 py-2 text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
          onClick={onEdit}
        >
          {editLabel}
        </button>
      </div>
    </section>
  );
}
