"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslateKey } from "@/shared/use-translate-key";
import { CATEGORY_GROUPS } from "../categories";
import type { CategoryScopeView, CategoryView } from "../contract";
import { createCategorySchema, renameCategorySchema, type CategoryScope } from "../validation";
import { useCategoryName } from "./use-category-name";

type Kind = "expense" | "income";

type Props = {
  /** The caller's household adjustments, or null without a household. */
  household: CategoryScopeView | null;
  /** The caller's own adjustments. */
  personal: CategoryScopeView;
  /** Endpoint. Default: /api/categories */
  action?: string;
};

/** Sends a JSON request; true when it succeeded, "duplicate" on 409, else false. */
async function send(url: string, method: string, body: unknown): Promise<true | false | "duplicate"> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (response?.status === 409) return "duplicate";
  return Boolean(response?.ok);
}

/**
 * Household and personal categories: standard groups and subcategories (hide or show), own ones
 * (rename, archive, restore) and a form to add a group or subcategory. One scope at a time.
 */
export function CategoryManager({ household, personal, action = "/api/categories" }: Props) {
  const t = useTranslations("transactions.categoryManager");
  const [scope, setScope] = useState<CategoryScope>(household ? "household" : "personal");
  const view = scope === "household" && household ? household : personal;

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="tabs tabs-box">
        {household && (
          <button type="button" role="tab" aria-selected={scope === "household"} className={`tab ${scope === "household" ? "tab-active" : ""}`} onClick={() => setScope("household")}>
            {t("scopeHousehold")}
          </button>
        )}
        <button type="button" role="tab" aria-selected={scope === "personal"} className={`tab ${scope === "personal" ? "tab-active" : ""}`} onClick={() => setScope("personal")}>
          {t("scopePersonal")}
        </button>
      </div>
      <p className="text-base-content/70 text-sm">{scope === "household" ? t("scopeHouseholdHint") : t("scopePersonalHint")}</p>
      {!household && <p className="text-base-content/70 text-sm">{t("noHousehold")}</p>}
      {(["expense", "income"] as const).map((kind) => (
        <KindSection key={`${scope}-${kind}`} scope={scope} kind={kind} view={view} action={action} />
      ))}
      <ArchivedList key={`${scope}-archived`} categories={view.categories.filter((c) => c.archived)} action={action} />
      <div className="divider my-0" />
      <AddCategoryForm key={`${scope}-add`} scope={scope} view={view} action={action} />
    </div>
  );
}

function KindSection({ scope, kind, view, action }: { scope: CategoryScope; kind: Kind; view: CategoryScopeView; action: string }) {
  const t = useTranslations("transactions.categoryManager");
  const active = view.categories.filter((c) => !c.archived && c.kind === kind);
  const ownGroups = active.filter((c) => c.parentKey === null);
  const subsOf = (key: string) => active.filter((c) => c.parentKey === key);
  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{kind === "expense" ? t("expenses") : t("income")}</h2>
      <ul className="flex flex-col">
        {CATEGORY_GROUPS.filter((g) => g.kind === kind).map((group) => (
          <GroupItem
            key={group.key}
            title={<StandardRow scope={scope} categoryKey={group.key} hidden={view.hidden.includes(group.key)} />}
            count={group.subcategories.length + subsOf(group.key).length}
          >
            {group.subcategories.map((sub) => {
              const key = `${group.key}.${sub}`;
              return (
                <li key={key}>
                  <StandardRow scope={scope} categoryKey={key} hidden={view.hidden.includes(key)} />
                </li>
              );
            })}
            {subsOf(group.key).map((own) => (
              <li key={own.id}>
                <OwnRow category={own} action={action} />
              </li>
            ))}
          </GroupItem>
        ))}
        {ownGroups.map((own) => (
          <GroupItem key={own.id} title={<OwnRow category={own} action={action} />} count={subsOf(own.key).length}>
            {subsOf(own.key).map((sub) => (
              <li key={sub.id}>
                <OwnRow category={sub} action={action} />
              </li>
            ))}
          </GroupItem>
        ))}
      </ul>
    </section>
  );
}

/** A group with its subcategories folded away. */
function GroupItem({ title, count, children }: { title: ReactNode; count: number; children: ReactNode }) {
  const t = useTranslations("transactions.categoryManager");
  return (
    <li className="border-base-200 border-b py-1">
      {title}
      {count > 0 && (
        <details className="ml-4">
          <summary className="text-base-content/70 cursor-pointer text-xs">{t("subcategories", { count })}</summary>
          <ul className="flex flex-col">{children}</ul>
        </details>
      )}
    </li>
  );
}

/** A standard category with a switch to hide or show it in this scope. */
function StandardRow({ scope, categoryKey, hidden }: { scope: CategoryScope; categoryKey: string; hidden: boolean }) {
  const t = useTranslations("transactions.categoryManager");
  const name = useCategoryName();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    setPending(true);
    const result = await send("/api/categories/hidden", "PUT", { scope, key: categoryKey, hidden: !hidden });
    setPending(false);
    setError(result !== true);
    if (result === true) router.refresh();
  }

  return (
    <div className="flex min-h-9 items-center justify-between gap-2">
      <span className={`min-w-0 truncate ${hidden ? "opacity-50 line-through" : ""}`}>{name(categoryKey)}</span>
      <span className="flex shrink-0 items-center gap-1">
        {error && (
          <span role="alert" className="text-error text-xs">
            {t("failed")}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-xs" disabled={pending} onClick={toggle}>
          {hidden ? t("show") : t("hide")}
        </button>
      </span>
    </div>
  );
}

/** An own category: rename inline, archive. */
function OwnRow({ category, action }: { category: CategoryView; action: string }) {
  const t = useTranslations("transactions.categoryManager");
  const translateKey = useTranslateKey();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: unknown) {
    setPending(true);
    setError(null);
    const result = await send(`${action}/${category.id}`, "PATCH", body);
    setPending(false);
    if (result === "duplicate") setError(t("duplicate"));
    else if (!result) setError(t("failed"));
    else router.refresh();
    return result === true;
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = renameCategorySchema.safeParse({ name });
    if (!parsed.success) return setError(translateKey(parsed.error.issues[0].message));
    if (await patch({ name })) setEditing(false);
  }

  return (
    <div className="flex flex-col">
      {editing ? (
        <form onSubmit={onSave} className="flex min-h-9 items-center gap-2">
          <input className="input input-sm min-w-0 flex-1" aria-label={t("name")} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-xs" disabled={pending}>
            {t("save")}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(false)}>
            {t("cancel")}
          </button>
        </form>
      ) : (
        // On a narrow screen the buttons wrap below the name instead of cutting it off.
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-2">
          <span className="flex min-w-32 flex-1 items-center gap-2">
            <span className="truncate">{category.name}</span>
            <span className="badge badge-ghost badge-sm shrink-0 text-base-content/70">{t("own")}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(true)}>
              {t("rename")}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" disabled={pending} onClick={() => patch({ archived: true })}>
              {t("archive")}
            </button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-error text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** Archived own categories, folded away, each with a restore button. */
function ArchivedList({ categories, action }: { categories: CategoryView[]; action: string }) {
  const t = useTranslations("transactions.categoryManager");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (categories.length === 0) return null;

  async function restore(id: string) {
    setError(null);
    const result = await send(`${action}/${id}`, "PATCH", { archived: false });
    if (result === "duplicate") setError(t("duplicate"));
    else if (!result) setError(t("failed"));
    else router.refresh();
  }

  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold">{t("archivedTitle", { count: categories.length })}</summary>
      <ul className="flex flex-col">
        {categories.map((c) => (
          <li key={c.id} className="flex min-h-9 items-center justify-between gap-2">
            <span className="truncate opacity-70">{c.name}</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => restore(c.id)}>
              {t("restore")}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-error text-xs">
          {error}
        </p>
      )}
    </details>
  );
}

/** Adds a group (no parent) or a subcategory of a standard or own group of the chosen type. */
function AddCategoryForm({ scope, view, action }: { scope: CategoryScope; view: CategoryScopeView; action: string }) {
  const t = useTranslations("transactions.categoryManager");
  const categoryName = useCategoryName();
  const translateKey = useTranslateKey();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("expense");
  const [parentKey, setParentKey] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parents = [
    ...CATEGORY_GROUPS.filter((g) => g.kind === kind).map((g) => ({ key: g.key, name: categoryName(g.key) })),
    ...view.categories.filter((c) => !c.archived && c.kind === kind && c.parentKey === null).map((c) => ({ key: c.key, name: c.name })),
  ];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { scope, kind, parentKey: parentKey || null, name };
    const parsed = createCategorySchema.safeParse(input);
    if (!parsed.success) return setError(translateKey(parsed.error.issues[0].message));
    setPending(true);
    setError(null);
    const result = await send(action, "POST", input);
    setPending(false);
    if (result === "duplicate") return setError(t("duplicate"));
    if (!result) return setError(t("failed"));
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("addTitle")}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="category-kind">
            {t("kind")}
          </label>
          <select
            id="category-kind"
            className="select w-full"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setParentKey("");
            }}
          >
            <option value="expense">{t("expenses")}</option>
            <option value="income">{t("income")}</option>
          </select>
        </fieldset>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="category-parent">
            {t("parent")}
          </label>
          <select id="category-parent" className="select w-full" value={parentKey} onChange={(e) => setParentKey(e.target.value)}>
            <option value="">{t("newGroup")}</option>
            {parents.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="fieldset">
          <label className="fieldset-legend" htmlFor="category-name">
            {t("name")}
          </label>
          <input id="category-name" className="input w-full" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </fieldset>
      </div>
      <button type="submit" className="btn btn-primary self-end" disabled={pending}>
        {pending && <span className="loading loading-spinner loading-sm" />}
        {t("addSubmit")}
      </button>
      {error && (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
