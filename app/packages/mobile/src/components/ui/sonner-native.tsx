import { Toaster as Sonner } from 'sonner-native';
import * as React from 'react';

function Toaster({ ...props }: React.ComponentProps<typeof Sonner>) {
  return <Sonner {...props} />;
}

export { Toaster };
