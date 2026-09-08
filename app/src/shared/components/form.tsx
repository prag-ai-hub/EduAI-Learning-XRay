/**
 * The one form primitive.
 *
 * The web app has 19 `<form onSubmit>` blocks that all share the same shape:
 * uncontrolled inputs carrying a `name`, `new FormData(event.currentTarget)`
 * inside the handler, browser validation from `required` / `minLength` /
 * `min` / `max`, a `.form-error` paragraph and a `.primary.full` submit button.
 * React Native has no `<form>`, no DOM FormData and no uncontrolled inputs, so
 * this file rebuilds that contract as components:
 *
 *     <Form onSubmit={(values) => save(values.get("name"))}>
 *       <Field name="name" label="Your name" required minLength={2} />
 *       <FormGrid>
 *         <Field name="city" label="City" />
 *         <Select name="board" label="Board" options={["CBSE", "ICSE"]} />
 *       </FormGrid>
 *       <FormError>{message}</FormError>
 *       <SubmitButton title={busy ? "Saving…" : "Save"} disabled={busy} />
 *     </Form>
 *
 * A ported screen therefore reads almost exactly like the original: the fields
 * stay "uncontrolled" (each one owns its text, the Form only reads them back on
 * submit), `values.get("x")` replaces `String(f.get("x"))`, and the button is
 * still the last child.
 *
 * FORMS SURVEYED - every one of them is covered by the components below.
 *
 *   frontend/app/signin/page.tsx
 *     1. sign-in / sign-up            email + password, .form-error, busy button
 *   frontend/app/register-school/page.tsx
 *     2. register school              name / city+board in .form-grid / admin_name / phone
 *   frontend/app/ui/FunctionalEduAIApp.tsx
 *     3. complete teacher profile     name, school, phone, subjects, classes (autoFocus)
 *     4. demo auth panel              email + password
 *     5. AssessmentDialog             8-cell .form-grid, selects, number, date, file inputs
 *     6. SetupDialog                  CONTROLLED number + two textareas + two selects
 *     7. RegradeDialog                three unnamed selects + required textarea
 *     8. InterventionForm             text, 3 selects + date in a .form-grid, textarea
 *     9. FollowupDialog               selects, two numbers in a .form-grid, named textarea
 *    10. ReportDialog                 selects + two `.check` checkboxes
 *    11. InviteDialog                 name/email + role/credits/school grid, async error
 *    12. CreditAllocationDialog       number + reason, async error, busy button
 *    13. UserEdit                     name/email/role select with defaultValue/phone
 *    14. ClassDialog                  four-cell grid + teacher select
 *    15. SchoolDialog                 name + city/board grid + unnamed input
 *    16. SimpleSettings               fields generated from an array; index 1 is a select
 *    17. StudentDialog                name + roll/class grid
 *    18. AcademicYearDialog           name + two dates in a grid + status select
 *    19. ConsentDialog                four `.check` checkboxes, three of them required
 *
 * Notes for the porting agents:
 *
 *   - Unnamed controls (forms 7, 8, 10, 14, 15, 16, 18 all have them) are legal:
 *     drop the `name` and the control still renders and validates but stays out
 *     of `values`, exactly as an unnamed DOM input stays out of FormData.
 *   - A `<select>` with no `defaultValue` submits its first option on the web.
 *     `Select` does the same, so form 5's `<select name="type">` still yields
 *     "Test" when the teacher never touches it.
 *   - Controlled fields (form 6) work too: pass `value` + `onChangeValue` and
 *     the Form still reads the value back on submit.
 *   - `<input type="file">` (form 5) has no RN equivalent and this app has no
 *     document-picker dependency installed. Whoever ports the picker/dropzone
 *     registers it with `useFormField({ name: "questionPaper", ... })`, so the
 *     picked document arrives as `values.raw("questionPaper")` and gets
 *     `required` handling for free. That is the single escape hatch; nothing
 *     else needs to know about files.
 *   - `Select` and `Field` also work OUTSIDE a `<Form>` as plain controlled
 *     inputs, which is what the standalone `.card select` filters need.
 *
 * Styling comes from app/src/theme/styles.ts only (`label`, `labelText`,
 * `input`, `textarea`, `formGrid`, `formGridCell`, `formGridCellFull`,
 * `formError`, `formErrorText`, `check`, `checkText`, `primary`, `secondary`,
 * `full`, `focusRing`, `modalBackdrop`, `modal`, `listItem`, ...). The only
 * pixels computed here are the checkbox box and the select chevron, because a
 * native checkbox/select had no CSS of its own to translate; both are built
 * from `Radius`/`Space` steps and palette tokens, never from literals.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Radius, Space, useAppPalette, useAppStyles } from '@/shared/theme/styles';

/* ------------------------------------------------------------------------- *
 * Values - the FormData replacement
 * ------------------------------------------------------------------------- */

/**
 * What `onSubmit` receives. `get`/`trimmed`/`number` cover every read the web
 * handlers did (`String(f.get(x))`, `String(f.get(x)||"").trim()`,
 * `Number(f.get(x))`); `raw` returns whatever a custom control stored, which is
 * how picked documents come back.
 */
export type FormValues = {
  /** `String(formData.get(name))`, with '' for a missing field and 'on' for a ticked box. */
  get: (name: string) => string;
  /** `get(name).trim()`. */
  trimmed: (name: string) => string;
  /** `Number(get(name))`, falling back to `fallback` (default 0) when not finite. */
  number: (name: string, fallback?: number) => number;
  /** A checkbox's state. */
  checked: (name: string) => boolean;
  /** The untouched value - use for anything a custom control registered. */
  raw: <T = unknown>(name: string) => T | undefined;
  has: (name: string) => boolean;
  /** Every named value at once. */
  all: () => Record<string, unknown>;
};

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'on' : ''; // FormData's checkbox encoding
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function makeValues(raw: Record<string, unknown>): FormValues {
  const get = (name: string) => toText(raw[name]);
  return {
    get,
    trimmed: (name) => get(name).trim(),
    number: (name, fallback = 0) => {
      const parsed = Number(get(name));
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    checked: (name) => raw[name] === true,
    raw: <T,>(name: string) => raw[name] as T | undefined,
    has: (name) => name in raw,
    all: () => ({ ...raw }),
  };
}

/* ------------------------------------------------------------------------- *
 * Context
 * ------------------------------------------------------------------------- */

type FieldHandle = {
  name?: string;
  value: unknown;
  /** Returns the message to show, or null when the field is valid. */
  validate: () => string | null;
  setError: (message: string | null) => void;
  focus?: () => void;
};

type FormContextValue = {
  register: (id: string, handle: RefObject<FieldHandle>) => () => void;
  /** Validate, then run `onSubmit`. Safe to call from anywhere in the tree. */
  submit: () => void;
  submitting: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  /** Read the current values without submitting. */
  values: () => FormValues;
  /** A mounted <FormError/> claims the slot so <Form> does not append its own. */
  claimErrorSlot: () => () => void;
};

const FormContext = createContext<FormContextValue | null>(null);

/** The form a component sits in. Throws outside a `<Form>`. */
export function useFormContext(): FormContextValue {
  const form = useContext(FormContext);
  if (!form) throw new Error('useFormContext must be used inside a <Form>.');
  return form;
}

/* ------------------------------------------------------------------------- *
 * useFormField - one registration path for every control
 * ------------------------------------------------------------------------- */

export type UseFormFieldOptions<T> = {
  /** Omit to keep the control out of `values`, like an unnamed DOM input. */
  name?: string;
  /** Initial value when uncontrolled - the `defaultValue` attribute. */
  defaultValue: T;
  /** Pass to drive the control from outside; `onChangeValue` then owns updates. */
  value?: T;
  onChangeValue?: (value: T) => void;
  required?: boolean;
  requiredMessage?: string;
  /** Extra rules. Return a message to block submission, or null to allow it. */
  validate?: (value: T) => string | null;
  /** Lets the form focus the first invalid control. */
  focus?: () => void;
};

/**
 * Refs that must be current before any user interaction, refreshed after every
 * render rather than during it.
 *
 * Writing `ref.current = x` in the render body is what this replaces. React
 * Compiler is enabled (app.json `experiments.reactCompiler`), and it may skip
 * a render whose inputs have not changed - taking the assignment with it and
 * leaving a stale closure. A layout effect runs before paint, so the handle is
 * already fresh by the time a submit can fire; `useEffect` on the web server
 * render, where there is no layout pass and React would warn.
 */
const useFreshRefs = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type FormFieldState<T> = {
  value: T;
  setValue: (next: T) => void;
  error: string | null;
  setError: (message: string | null) => void;
};

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'boolean') return !value; // an unticked required checkbox
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Registers any control with the surrounding form: it keeps the value, runs
 * validation on submit and surfaces the message. Use it directly for controls
 * this file does not provide - a document picker, a dropzone, a date wheel.
 * Outside a `<Form>` it degrades to plain local (or controlled) state.
 */
export function useFormField<T>(options: UseFormFieldOptions<T>): FormFieldState<T> {
  const { name, defaultValue, value, onChangeValue, required, requiredMessage, validate, focus } =
    options;

  const form = useContext(FormContext);
  const id = useId();
  const [internal, setInternal] = useState<T>(defaultValue);
  const [error, setError] = useState<string | null>(null);

  const controlled = value !== undefined;
  const current = controlled ? (value as T) : internal;

  // Latest-value refs: the handle below is registered once but must always see
  // the newest closure, so it is refreshed after every render (see useFreshRefs).
  const changeRef = useRef(onChangeValue);
  const controlledRef = useRef(controlled);

  const setValue = useCallback((next: T) => {
    if (!controlledRef.current) setInternal(next);
    setError(null); // editing clears the message, as re-validating does on the web
    changeRef.current?.(next);
  }, []);

  const handle = useRef<FieldHandle>({
    name,
    value: current,
    validate: () => null,
    setError,
  });
  useFreshRefs(() => {
    changeRef.current = onChangeValue;
    controlledRef.current = controlled;
    handle.current = {
      name,
      value: current,
      validate: () => {
        if (required && isEmptyValue(current)) return requiredMessage ?? 'This field is required.';
        return validate ? validate(current) : null;
      },
      setError,
      focus,
    };
  });

  useEffect(() => {
    if (!form) return;
    return form.register(id, handle);
  }, [form, id]);

  // Calling this hook from the same component that renders <Form> puts it
  // OUTSIDE the provider, so it never registers: `required` is not enforced and
  // the value is missing from submit, silently. It has to run in a child.
  useEffect(() => {
    if (__DEV__ && !form && name) {
      console.warn(
        `useFormField("${name}") is not inside a <Form>: its value will not be ` +
          'submitted and `required` will not be enforced. Call it from a component ' +
          'rendered inside <Form>, not from the one that renders <Form> itself.',
      );
    }
  }, [form, name]);

  return { value: current, setValue, error, setError };
}

/* ------------------------------------------------------------------------- *
 * Form
 * ------------------------------------------------------------------------- */

export type FormProps = {
  /**
   * Runs once every registered control validates. Throwing (or rejecting) is
   * how a handler reports a failure - the message lands in <FormError/>, which
   * is what the `try { … } catch { setError(…) }` dialogs did by hand.
   */
  onSubmit: (values: FormValues) => void | Promise<void>;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Shown when a field fails validation. */
  invalidMessage?: string;
  /** Shown when `onSubmit` throws something that is not an Error. */
  failureMessage?: string;
};

export function Form({
  onSubmit,
  children,
  style,
  invalidMessage = 'Check the highlighted fields and try again.',
  failureMessage = 'Something went wrong. Please try again.',
}: FormProps) {
  const s = useAppStyles();
  const registry = useRef(new Map<string, RefObject<FieldHandle>>());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const slots = useRef(0);
  const [hasErrorSlot, setHasErrorSlot] = useState(false);

  const submitRef = useRef(onSubmit);
  useFreshRefs(() => {
    submitRef.current = onSubmit;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      // Dialogs unmount themselves inside onSubmit (`done()`); this keeps the
      // finally-block state updates from landing on a dead component.
      alive.current = false;
    };
  }, []);

  const register = useCallback((id: string, handle: RefObject<FieldHandle>) => {
    registry.current.set(id, handle);
    return () => {
      registry.current.delete(id);
    };
  }, []);

  const claimErrorSlot = useCallback(() => {
    slots.current += 1;
    setHasErrorSlot(true);
    return () => {
      slots.current -= 1;
      if (slots.current <= 0) setHasErrorSlot(false);
    };
  }, []);

  const values = useCallback(() => {
    const raw: Record<string, unknown> = {};
    registry.current.forEach((handle) => {
      const field = handle.current;
      if (field.name) raw[field.name] = field.value;
    });
    return makeValues(raw);
  }, []);

  const submit = useCallback(() => {
    if (busy.current) return;

    const invalid: FieldHandle[] = [];
    registry.current.forEach((handle) => {
      const field = handle.current;
      const message = field.validate();
      field.setError(message);
      if (message) invalid.push(field);
    });
    if (invalid.length) {
      setError(invalidMessage);
      invalid[0].focus?.();
      return;
    }

    setError(null);
    busy.current = true;
    setSubmitting(true);
    void (async () => {
      try {
        await submitRef.current(values());
      } catch (cause) {
        if (alive.current) setError(cause instanceof Error ? cause.message : failureMessage);
      } finally {
        busy.current = false;
        if (alive.current) setSubmitting(false);
      }
    })();
  }, [failureMessage, invalidMessage, values]);

  return (
    <FormContext.Provider
      value={{ register, submit, submitting, error, setError, values, claimErrorSlot }}>
      <View role="form" style={style}>
        {children}
        {/* Fallback: a form with no <FormError/> would otherwise fail silently. */}
        {!hasErrorSlot && error ? (
          <View role="alert" style={s.formError}>
            <Text style={s.formErrorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    </FormContext.Provider>
  );
}

/* ------------------------------------------------------------------------- *
 * FormError - `<p className="form-error" role="alert">`
 * ------------------------------------------------------------------------- */

/**
 * Put this where the original had its `.form-error` paragraph, usually just
 * above the submit button. `<FormError>{message}</FormError>` prefers the
 * screen's own message and falls back to the form's (validation or a thrown
 * submit error); `<FormError />` always shows the form's.
 */
export function FormError({ children }: { children?: string | null | false }) {
  const s = useAppStyles();
  const form = useContext(FormContext);
  const claim = form?.claimErrorSlot;

  useEffect(() => {
    if (!claim) return;
    return claim();
  }, [claim]);

  const message = (typeof children === 'string' ? children.trim() : '') || form?.error || '';
  if (!message) return null;

  return (
    <View role="alert" style={s.formError}>
      <Text style={s.formErrorText}>{message}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------------- *
 * FormGrid - `<div className="form-grid">`
 * ------------------------------------------------------------------------- */

/**
 * The two-column `.form-grid`. Each child is wrapped in a cell; on compact
 * widths `formGridCell` is already full-width, so this collapses to one column
 * exactly like the CSS media query did. Wrap a child in `<FormGridFull>` to
 * make it span both columns.
 */
export function FormGrid({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useAppStyles();
  const items = flattenChildren(children);

  return (
    <View style={[s.formGrid, style]}>
      {items.map((child, index) => (
        <View
          key={index}
          style={isFullCell(child) ? [s.formGridCell, s.formGridCellFull] : s.formGridCell}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** A `<FormGrid>` child that should span the full row. */
export function FormGridFull({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function flattenChildren(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const walk = (node: ReactNode) => {
    if (node === null || node === undefined || node === false || node === true) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    out.push(node);
  };
  walk(children);
  return out;
}

function isFullCell(child: ReactNode): boolean {
  return (
    typeof child === 'object' &&
    child !== null &&
    'type' in child &&
    (child as { type?: unknown }).type === FormGridFull
  );
}

/* ------------------------------------------------------------------------- *
 * Field - `<label>Text<input|textarea/></label>`
 * ------------------------------------------------------------------------- */

export type FieldType = 'text' | 'email' | 'password' | 'tel' | 'number' | 'date' | 'textarea';

export type FieldProps = {
  name?: string;
  label?: string;
  type?: FieldType;
  defaultValue?: string;
  /** Controlled mode - pair with `onChangeValue`. */
  value?: string;
  onChangeValue?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  requiredMessage?: string;
  minLength?: number;
  maxLength?: number;
  /** `type="number"` only. */
  min?: number;
  max?: number;
  autoFocus?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  editable?: boolean;
  /** Extra rule; return a message to block submission. */
  validate?: (value: string) => string | null;
  /** Enter submits the form, matching a browser's implicit submission. */
  submitOnEnter?: boolean;
  /** Escape hatch for anything not modelled above. */
  inputProps?: TextInputProps;
  style?: StyleProp<ViewStyle>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const INPUT_MODE: Partial<Record<FieldType, TextInputProps['inputMode']>> = {
  email: 'email',
  tel: 'tel',
  number: 'numeric',
};

export function Field({
  name,
  label,
  type = 'text',
  defaultValue = '',
  value,
  onChangeValue,
  placeholder,
  required,
  requiredMessage,
  minLength,
  maxLength,
  min,
  max,
  autoFocus,
  autoComplete,
  editable = true,
  validate,
  submitOnEnter = true,
  inputProps,
  style,
}: FieldProps) {
  const s = useAppStyles();
  const p = useAppPalette();
  const form = useContext(FormContext);
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const field = useFormField<string>({
    name,
    defaultValue,
    value,
    onChangeValue,
    required,
    requiredMessage,
    focus: () => input.current?.focus(),
    validate: (text) => {
      const trimmed = text.trim();
      if (trimmed) {
        if (minLength && trimmed.length < minLength)
          return `Use at least ${minLength} characters.`;
        if (maxLength && trimmed.length > maxLength) return `Use at most ${maxLength} characters.`;
        if (type === 'email' && !EMAIL.test(trimmed)) return 'Enter a valid email address.';
        if (type === 'date' && !ISO_DATE.test(trimmed)) return 'Use the date format YYYY-MM-DD.';
        if (type === 'number') {
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed)) return 'Enter a number.';
          if (min !== undefined && parsed < min) return `Enter a number of at least ${min}.`;
          if (max !== undefined && parsed > max) return `Enter a number of at most ${max}.`;
        }
      }
      return validate ? validate(text) : null;
    },
  });

  const multiline = type === 'textarea';

  return (
    <View style={[s.label, style]}>
      {label ? <Text style={s.labelText}>{label}</Text> : null}
      <TextInput
        ref={input}
        style={[s.input, multiline && s.textarea, focused && s.focusRing]}
        value={field.value}
        onChangeText={field.setValue}
        placeholder={placeholder}
        placeholderTextColor={p.muted}
        // type="date": RN has no date input and no date picker is installed, so
        // the field is typed as YYYY-MM-DD and validated against that shape.
        // See the platform notes at the top of this file.
        inputMode={INPUT_MODE[type]}
        secureTextEntry={type === 'password'}
        autoCapitalize={type === 'email' || type === 'password' ? 'none' : 'sentences'}
        autoCorrect={type !== 'email' && type !== 'password'}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        editable={editable}
        multiline={multiline}
        accessibilityLabel={label ?? name}
        aria-invalid={Boolean(field.error)}
        returnKeyType={multiline ? 'default' : 'done'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={() => {
          if (submitOnEnter && !multiline) form?.submit();
        }}
        {...inputProps}
      />
      {field.error ? (
        <Text role="alert" style={s.formErrorText}>
          {field.error}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------- *
 * Select - `<select><option/></select>`
 * ------------------------------------------------------------------------- */

export type SelectOption = string | { label: string; value: string };

export type SelectProps = {
  name?: string;
  label?: string;
  options: readonly SelectOption[];
  /** Defaults to the first option, exactly as a `<select>` does. */
  defaultValue?: string;
  /** Controlled mode - pair with `onValueChange`. */
  value?: string;
  onValueChange?: (value: string) => void;
  /**
   * Renders as an unselected first row (`<option value="">`) and makes the
   * initial value ''. Without it the first option is pre-selected.
   */
  placeholder?: string;
  required?: boolean;
  requiredMessage?: string;
  disabled?: boolean;
  /** Heading of the option sheet; defaults to `label`. */
  title?: string;
  style?: StyleProp<ViewStyle>;
};

function optionLabel(option: SelectOption): string {
  return typeof option === 'string' ? option : option.label;
}

function optionValue(option: SelectOption): string {
  return typeof option === 'string' ? option : option.value;
}

export function Select({
  name,
  label,
  options,
  defaultValue,
  value,
  onValueChange,
  placeholder,
  required,
  requiredMessage,
  disabled,
  title,
  style,
}: SelectProps) {
  const s = useAppStyles();
  const p = useAppPalette();
  const [open, setOpen] = useState(false);

  const initial = defaultValue ?? (placeholder ? '' : options[0] ? optionValue(options[0]) : '');

  const field = useFormField<string>({
    name,
    defaultValue: initial,
    value,
    onChangeValue: onValueChange,
    required,
    requiredMessage,
    focus: () => setOpen(true), // the closest thing to focusing a <select>
  });

  const selected = options.find((option) => optionValue(option) === field.value);
  const text = selected ? optionLabel(selected) : (placeholder ?? '');

  return (
    <View style={[s.label, style]}>
      {label ? <Text style={s.labelText}>{label}</Text> : null}
      <Pressable
        role="combobox"
        accessibilityLabel={label ?? name}
        accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[s.input, selectRow, disabled && s.disabled]}>
        <Text style={{ color: selected ? p.text : p.muted }} numberOfLines={1}>
          {text}
        </Text>
        {/* The chevron a native <select> draws for itself. */}
        <Text style={{ color: p.muted }}>▾</Text>
      </Pressable>
      {field.error ? (
        <Text role="alert" style={s.formErrorText}>
          {field.error}
        </Text>
      ) : null}

      {/* One list implementation for web and native: react-native-web renders
          Modal too, so the option sheet behaves the same everywhere. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={[s.modal, s.functionalModal]} onPress={() => {}}>
            {(title ?? label) ? <Text style={s.eyebrow}>{title ?? label}</Text> : null}
            <ScrollView>
              {placeholder ? (
                <OptionRow
                  label={placeholder}
                  muted
                  selected={field.value === ''}
                  onPress={() => {
                    field.setValue('');
                    setOpen(false);
                  }}
                />
              ) : null}
              {options.map((option) => {
                const optionText = optionValue(option);
                return (
                  <OptionRow
                    key={optionText}
                    label={optionLabel(option)}
                    selected={optionText === field.value}
                    onPress={() => {
                      field.setValue(optionText);
                      setOpen(false);
                    }}
                  />
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function OptionRow({
  label,
  selected,
  muted,
  onPress,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  const s = useAppStyles();
  const p = useAppPalette();

  return (
    <Pressable
      role="menuitem"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [s.listItem, pressed && s.rowButtonHover]}>
      <Text style={[s.listItemText, muted ? { color: p.muted } : null]}>{label}</Text>
      {selected ? <Text style={s.listItemAction}>✓</Text> : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------------- *
 * Checkbox - `<label className="check"><input type="checkbox"/> Text</label>`
 * ------------------------------------------------------------------------- */

export type CheckboxProps = {
  name?: string;
  label: string;
  defaultChecked?: boolean;
  /** Controlled mode - pair with `onCheckedChange`. */
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** A required box must be ticked before the form submits, as on the web. */
  required?: boolean;
  requiredMessage?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Checkbox({
  name,
  label,
  defaultChecked = false,
  checked,
  onCheckedChange,
  required,
  requiredMessage,
  disabled,
  style,
}: CheckboxProps) {
  const s = useAppStyles();
  const p = useAppPalette();

  const field = useFormField<boolean>({
    name,
    defaultValue: defaultChecked,
    value: checked,
    onChangeValue: onCheckedChange,
    required,
    requiredMessage: requiredMessage ?? 'Tick this box to continue.',
  });

  return (
    <View style={style}>
      <Pressable
        role="checkbox"
        accessibilityState={{ checked: field.value, disabled: Boolean(disabled) }}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => field.setValue(!field.value)}
        style={[s.check, checkRow, disabled && s.disabled]}>
        {/* The browser's default checkbox had no CSS to translate, so the box is
            built from theme steps: field/border like an input, navy when ticked. */}
        <View
          style={[
            checkBox,
            {
              borderColor: field.value ? p.navy : p.border,
              backgroundColor: field.value ? p.navy : p.field,
            },
          ]}>
          {field.value ? <Text style={[checkMark, { color: p.onNavy }]}>✓</Text> : null}
        </View>
        <Text style={s.checkText}>{label}</Text>
      </Pressable>
      {field.error ? (
        <Text role="alert" style={s.formErrorText}>
          {field.error}
        </Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------- *
 * SubmitButton - `<button className="primary full">`
 * ------------------------------------------------------------------------- */

export type SubmitButtonProps = {
  /** The label, computed by the caller: `busy ? "Saving…" : "Save"`. */
  title: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  /** `.full` - width 100% with the CSS's 18px top margin. On by default. */
  full?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SubmitButton({
  title,
  disabled,
  variant = 'primary',
  full = true,
  style,
}: SubmitButtonProps) {
  const s = useAppStyles();
  const form = useFormContext();
  const off = Boolean(disabled) || form.submitting;

  return (
    <Pressable
      role="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: form.submitting }}
      disabled={off}
      onPress={form.submit}
      style={({ pressed }) => [
        variant === 'primary' ? s.primary : s.secondary,
        full && s.full,
        // Native has no :hover; the CSS hover tint doubles as the press state.
        pressed && variant === 'primary' && s.primaryHover,
        off && s.primaryDisabled,
        style,
      ]}>
      <Text style={variant === 'primary' ? s.primaryText : s.secondaryText}>{title}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------------- *
 * The two shapes the CSS never described
 * ------------------------------------------------------------------------- */

/** `<select>` lays its value out against the chevron. */
const selectRow: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: Space.s8,
};

/** `.check` is a row already; this only stops it stretching to full width. */
const checkRow: ViewStyle = { alignSelf: 'flex-start', paddingVertical: Space.s6 };

const checkBox: ViewStyle = {
  width: Space.s18,
  height: Space.s18,
  borderWidth: 1,
  borderRadius: Radius.sm,
  alignItems: 'center',
  justifyContent: 'center',
};

const checkMark = { fontSize: Space.s12, fontWeight: '700' as const, lineHeight: Space.s14 };
