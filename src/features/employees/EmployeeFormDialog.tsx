import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError, Input, Label, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { employeesApi } from '@/features/api/resources';
import type { ApiEmployee } from '@/features/api/types';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  fullName: z.string().trim().min(3, 'admin.employees.errName'),
  employeeCode: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  role: z.enum(['DRIVER', 'ACCOUNTING', 'MANAGER', 'ADMIN', 'OTHER']),
  designation: z.string().trim().optional(),
  department: z.string().trim().optional(),
  joiningDate: z.string().trim().optional(),
  preferredLanguage: z.enum(['EN', 'HI', 'KN', 'MR', 'TA', 'TE']),
  baseSalary: z.string().trim().optional(),
  pfApplicable: z.boolean(),
  uan: z.string().trim().optional(),
  pfMemberId: z.string().trim().optional(),
});

type Values = z.infer<typeof schema>;

const LANGUAGE_OPTIONS: Values['preferredLanguage'][] = ['EN', 'HI', 'KN', 'MR', 'TA', 'TE'];
const ROLE_OPTIONS: Values['role'][] = ['DRIVER', 'ACCOUNTING', 'MANAGER', 'ADMIN', 'OTHER'];

/** Creates a new employee, or edits an existing one when `employee` is given. */
export function EmployeeFormDialog({
  employee,
  open,
  onOpenChange,
  onSaved,
}: {
  employee?: ApiEmployee;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (employee: ApiEmployee) => void;
}) {
  const { t } = useTranslation();
  const editing = Boolean(employee);

  const { register, handleSubmit, formState, reset, setError, watch, setValue } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'DRIVER', preferredLanguage: 'EN', pfApplicable: false },
  });

  // Load the record being edited whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    reset({
      fullName: employee?.fullName ?? '',
      employeeCode: employee?.employeeCode ?? '',
      phone: employee?.phone ?? '',
      email: employee?.email ?? '',
      role: employee?.role ?? 'DRIVER',
      designation: employee?.designation ?? '',
      department: employee?.department ?? '',
      joiningDate: employee?.joiningDate ?? '',
      preferredLanguage: employee?.preferredLanguage ?? 'EN',
      baseSalary: employee?.payroll?.baseSalary ?? '',
      pfApplicable: employee?.payroll?.pfApplicable ?? false,
      uan: employee?.payroll?.uan ?? '',
      pfMemberId: employee?.payroll?.pfMemberId ?? '',
    });
  }, [open, employee, reset]);

  const err = (key: keyof Values) => (formState.errors[key]?.message ? t(String(formState.errors[key]?.message)) : undefined);
  const pfApplicable = watch('pfApplicable');

  const submit = async (values: Values) => {
    const blankToUndefined = (value?: string) => (value && value.length > 0 ? value : undefined);
    const payload: Record<string, unknown> = {
      fullName: values.fullName,
      role: values.role,
      phone: blankToUndefined(values.phone),
      email: blankToUndefined(values.email),
      designation: blankToUndefined(values.designation),
      department: blankToUndefined(values.department),
      joiningDate: blankToUndefined(values.joiningDate),
      preferredLanguage: values.preferredLanguage,
      baseSalary: values.baseSalary ? Number(values.baseSalary) : undefined,
      pfApplicable: values.pfApplicable,
      uan: values.pfApplicable ? blankToUndefined(values.uan) : undefined,
      pfMemberId: values.pfApplicable ? blankToUndefined(values.pfMemberId) : undefined,
    };
    if (!editing) payload.employeeCode = blankToUndefined(values.employeeCode);

    try {
      const saved = employee ? await employeesApi.update(employee.id, payload) : await employeesApi.create(payload);
      toast.success(t(editing ? 'admin.employees.updated' : 'admin.employees.added', { name: saved.fullName }));
      onSaved(saved);
    } catch (error) {
      if (error instanceof ApiError) {
        // Map field-level messages from the API back onto the form.
        const fieldErrors = error.fieldErrors;
        let matched = false;
        for (const [field, message] of Object.entries(fieldErrors)) {
          if (field in schema.shape) {
            setError(field as keyof Values, { message });
            matched = true;
          }
        }
        if (!matched) toast.error(error.message);
      } else {
        toast.error(t('admin.api.errorTitle'));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('admin.employees.editTitle') : t('admin.employees.add')}</DialogTitle>
          <DialogDescription>{t('admin.employees.addHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emp-name">{t('admin.employees.name')}</Label>
              <Input id="emp-name" aria-invalid={!!formState.errors.fullName} {...register('fullName')} />
              <FieldError>{err('fullName')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-code">{t('admin.employees.employeeId')}</Label>
              <Input id="emp-code" placeholder={t('admin.employees.codeAuto')} disabled={editing} {...register('employeeCode')} />
              <FieldError>{err('employeeCode')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-phone">{t('admin.employees.phone')}</Label>
              <Input id="emp-phone" inputMode="tel" placeholder="+91 98450 12345" {...register('phone')} />
              <FieldError>{err('phone')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-email">{t('admin.employees.email')}</Label>
              <Input id="emp-email" type="email" {...register('email')} />
              <FieldError>{err('email')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-role">{t('admin.employees.role')}</Label>
              <NativeSelect id="emp-role" {...register('role')}>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {t(`admin.enum.employeeRole.${role}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-lang">{t('admin.employees.language')}</Label>
              <NativeSelect id="emp-lang" {...register('preferredLanguage')}>
                {LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang} value={lang}>
                    {t(`admin.enum.language.${lang}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-designation">{t('admin.employees.designation')}</Label>
              <Input id="emp-designation" {...register('designation')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-department">{t('admin.employees.department')}</Label>
              <Input id="emp-department" {...register('department')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-joined">{t('admin.employees.joined')}</Label>
              <Input id="emp-joined" type="date" {...register('joiningDate')} />
              <FieldError>{err('joiningDate')}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-salary">{t('admin.employees.baseSalary')}</Label>
              <Input id="emp-salary" inputMode="decimal" {...register('baseSalary')} />
              <FieldError>{err('baseSalary')}</FieldError>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t('admin.employees.pfApplicable')}</p>
                <p className="text-xs text-muted-foreground">{t('admin.employees.pfHint')}</p>
              </div>
              <Switch checked={pfApplicable} onCheckedChange={(checked) => setValue('pfApplicable', checked)} aria-label={t('admin.employees.pfApplicable')} />
            </div>
            {pfApplicable && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-uan">{t('admin.employees.uan')}</Label>
                  <Input id="emp-uan" inputMode="numeric" placeholder="100200300400" {...register('uan')} />
                  <FieldError>{err('uan')}</FieldError>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-pfid">{t('admin.employees.pfMemberId')}</Label>
                  <Input id="emp-pfid" {...register('pfMemberId')} />
                  <FieldError>{err('pfMemberId')}</FieldError>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
