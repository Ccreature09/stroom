import {
  PERMISSION_FIELDS,
  PERMISSION_LABELS,
} from "@/lib/people-roles/constants";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface PermissionMatrixProps {
  prefix: string;
  defaults?: Record<string, boolean | null>;
}

export function PermissionMatrix({ prefix, defaults }: PermissionMatrixProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {PERMISSION_FIELDS.map((field) => {
        const id = `${prefix}-${field}`;
        return (
          <div
            key={id}
            className="flex items-center space-x-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <Checkbox
              id={id}
              name={field}
              defaultChecked={defaults?.[field] === true}
            />
            <Label
              htmlFor={id}
              className="cursor-pointer text-sm font-normal text-slate-700"
            >
              {PERMISSION_LABELS[field]}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
