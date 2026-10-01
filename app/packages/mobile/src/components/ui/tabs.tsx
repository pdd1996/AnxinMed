import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import * as TabsPrimitive from '@rn-primitives/tabs';
import { Platform } from 'react-native';

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} {...props} />;
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'bg-muted flex h-9 flex-row items-center justify-center rounded-lg p-[3px]',
        Platform.select({ web: 'inline-flex w-fit', native: 'mr-auto' }),
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { value } = TabsPrimitive.useRootContext();
  const active = props.value === value;
  return (
    <TextClassContext.Provider value="text-sm font-medium">
      <TabsPrimitive.Trigger
        className={cn(
          'flex h-[calc(100%-1px)] flex-row items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 shadow-none shadow-black/5',
          Platform.select({
            web: 'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring inline-flex cursor-default whitespace-nowrap transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
          }),
          props.disabled && 'opacity-50',
          // 选中态只用**实色令牌**：原形态 `bg-background dark:bg-input/30 dark:border-foreground/10` 在 mobile 上
          // 后两条带 `/alpha` 修饰符的类整条不落进产物（见 mobile/README「令牌色带透明度修饰符会整条静默丢失」与
          // 05d §7-7），实测深色下选中格只剩 `bg-background`（与页面同色）→ 选中态看不出来；
          // 文字同理：`dark:text-foreground` 与 `dark:text-muted-foreground` 同挂一个元素，RN 侧落谁由 CSS 顺序定，
          // 实测与 web 语义相反（谁被选中谁变黑）。故底色走 bg-primary、字色由调用方在 Text 上显式给一档实色。
          active && 'bg-primary',
          className
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(Platform.select({ web: 'flex-1 outline-none' }), className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
