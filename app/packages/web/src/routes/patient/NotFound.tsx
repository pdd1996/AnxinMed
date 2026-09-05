import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">安心用药</p>
        <h1 className="text-2xl font-bold">页面不存在</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">找不到该路由</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-muted-foreground">
          <p>你访问的地址没有对应页面。可返回今日任务重新开始。</p>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/">回到今日任务</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
