import { useTranslations } from "next-intl";
import { standardChoices, type CategoryChoice } from "../categories";
import type { TransactionKind } from "../kinds";
import { useCategoryName } from "./use-category-name";

type Props = {
  id: string;
  kinds: readonly TransactionKind[];
  value: string;
  onChange: (value: string) => void;
  /** Text of the empty option. */
  emptyLabel: string;
  /** Adds an option "without category" (value `none`) after the empty one. */
  noneLabel?: string;
  /** The categories to offer (the page's catalog for the account). Default: the standard categories. */
  groups?: CategoryChoice[];
  /** Names of own categories, for a value that is not offered any more (e.g. archived). */
  names?: Record<string, string>;
};

/** A select with the category groups of the given types; subcategories are indented under their group. */
export function CategorySelect({ id, kinds, value, onChange, emptyLabel, noneLabel, groups = standardChoices(), names }: Props) {
  const t = useTranslations("transactions");
  const name = useCategoryName(names);
  const label = (choice: { key: string; name: string | null }) => choice.name ?? name(choice.key);
  const offered = new Set(groups.flatMap((g) => [g.key, ...g.subcategories.map((s) => s.key)]));
  return (
    <select id={id} className="select w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {noneLabel && <option value="none">{noneLabel}</option>}
      {/* A current value that is not offered any more (hidden or archived) stays selectable. */}
      {value && value !== "none" && !offered.has(value) && <option value={value}>{name(value)}</option>}
      {kinds.map((kind) => {
        const ofKind = groups.filter((group) => group.kind === kind);
        return ofKind.length === 0 ? null : (
          <optgroup key={kind} label={t(`kinds.${kind}`)}>
            {ofKind.flatMap((group) => [
              <option key={group.key} value={group.key}>
                {label(group)}
              </option>,
              ...group.subcategories.map((sub) => (
                <option key={sub.key} value={sub.key}>
                  {"   "}
                  {label(sub)}
                </option>
              )),
            ])}
          </optgroup>
        );
      })}
    </select>
  );
}
