import { Icon } from '@/components/ui/icon';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@rn-primitives/dialog';
import { X } from 'lucide-react-native';
import * as React from 'react';
import {
  Platform,
  Text,
  View,
  type GestureResponderEvent,
  type ViewProps,
} from 'react-native';
import {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideInLeft,
  SlideInRight,
  SlideInUp,
  SlideOutDown,
  SlideOutLeft,
  SlideOutRight,
  SlideOutUp,
} from 'react-native-reanimated';
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens';

const Sheet = DialogPrimitive.Root;

const SheetTrigger = DialogPrimitive.Trigger;

const SheetClose = DialogPrimitive.Close;

const SheetPortal = DialogPrimitive.Portal;

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment;

type SheetSide = 'top' | 'bottom' | 'left' | 'right';

type SlideInBuilder =
  | typeof SlideInDown
  | typeof SlideInUp
  | typeof SlideInLeft
  | typeof SlideInRight;
type SlideOutBuilder =
  | typeof SlideOutDown
  | typeof SlideOutUp
  | typeof SlideOutLeft
  | typeof SlideOutRight;

const SIDE_ANIMATIONS: Record<SheetSide, { entering: SlideInBuilder; exiting: SlideOutBuilder }> = {
  top: { entering: SlideInUp, exiting: SlideOutUp },
  bottom: { entering: SlideInDown, exiting: SlideOutDown },
  left: { entering: SlideInLeft, exiting: SlideOutLeft },
  right: { entering: SlideInRight, exiting: SlideOutRight },
};

const SIDE_CONTENT_CLASS: Record<SheetSide, string> = {
  top: 'inset-x-0 top-0 rounded-b-lg border-b',
  bottom: 'inset-x-0 bottom-0 rounded-t-lg border-t',
  left: 'inset-y-0 left-0 h-full w-3/4 rounded-r-lg border-r sm:max-w-sm',
  right: 'inset-y-0 right-0 h-full w-3/4 rounded-l-lg border-l sm:max-w-sm',
};

function SheetOverlay({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Overlay>, 'asChild'> & {
  children?: React.ReactNode;
}) {
  const { onOpenChange } = DialogPrimitive.useRootContext();

  function onOverlayPress(event: GestureResponderEvent) {
    if (event.target === event.currentTarget && !event.isDefaultPrevented()) {
      onOpenChange(false);
    }
  }

  return (
    <FullWindowOverlay>
      <DialogPrimitive.Overlay
        className={cn(
          'absolute inset-0 z-50 bg-black/50',
          Platform.select({
            web: 'animate-in fade-in-0 fixed cursor-default',
          }),
          className
        )}
        {...props}
        onPress={onOverlayPress}
        asChild={Platform.OS !== 'web'}>
        <NativeOnlyAnimatedView
          entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
          as="Pressable">
          <>{children}</>
        </NativeOnlyAnimatedView>
      </DialogPrimitive.Overlay>
    </FullWindowOverlay>
  );
}

function SheetContent({
  className,
  children,
  side = 'bottom',
  portalHost,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalHost?: string;
  side?: SheetSide;
}) {
  const { entering, exiting } = SIDE_ANIMATIONS[side];

  return (
    <SheetPortal hostName={portalHost}>
      <SheetOverlay>
        <NativeOnlyAnimatedView
          entering={entering.duration(300).reduceMotion(ReduceMotion.System)}
          exiting={exiting.duration(250).reduceMotion(ReduceMotion.System)}>
          <DialogPrimitive.Content
            className={cn(
              'bg-background border-border z-50 flex flex-col gap-4 border p-6 shadow-lg shadow-black/5',
              SIDE_CONTENT_CLASS[side],
              Platform.select({
                web: 'fixed animate-in duration-200',
              }),
              className
            )}
            {...props}>
            <>{children}</>
            <DialogPrimitive.Close
              className={cn(
                'absolute right-4 top-4 rounded opacity-70 active:opacity-100',
                Platform.select({
                  web: 'ring-offset-background focus:ring-ring transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2',
                })
              )}
              hitSlop={12}>
              <Icon
                as={X}
                className={cn('text-accent-foreground web:pointer-events-none size-4 shrink-0')}
              />
              <Text className="sr-only">Close</Text>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </NativeOnlyAnimatedView>
      </SheetOverlay>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: ViewProps) {
  return <View className={cn('flex flex-col gap-2', className)} {...props} />;
}

function SheetFooter({ className, ...props }: ViewProps) {
  return <View className={cn('flex flex-col-reverse gap-2', className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-foreground text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
