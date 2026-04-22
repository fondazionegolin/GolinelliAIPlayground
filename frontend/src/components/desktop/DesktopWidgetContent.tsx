import ClockWidget from '@/components/desktop/widgets/ClockWidget'
import NoteWidget from '@/components/desktop/widgets/NoteWidget'
import TasklistWidget from '@/components/desktop/widgets/TasklistWidget'
import CalendarWidget from '@/components/desktop/widgets/CalendarWidget'
import WeeklyCalendarWidget from '@/components/desktop/widgets/WeeklyCalendarWidget'
import FileRefWidget from '@/components/desktop/widgets/FileRefWidget'
import ImageRefWidget from '@/components/desktop/widgets/ImageRefWidget'
import OggiImparoWidget from '@/components/desktop/widgets/OggiImparoWidget'

export interface DesktopWidgetRecord {
  id: string
  desktop_id?: string
  widget_type: string
  grid_x: number
  grid_y: number
  grid_w: number
  grid_h: number
  config_json: Record<string, unknown>
  is_locked?: boolean
}

export default function DesktopWidgetContent({
  widget,
  onConfigChange,
  onOpenFile,
  userType,
  sessionName,
  readOnly = false,
}: {
  widget: DesktopWidgetRecord
  onConfigChange: (config: Record<string, unknown>) => void
  onOpenFile: (file: { url: string; filename: string; type?: string }) => void
  userType: 'teacher' | 'student'
  sessionName?: string
  readOnly?: boolean
}) {
  switch (widget.widget_type) {
    case 'CLOCK':
      return (
        <ClockWidget
          config={widget.config_json as Parameters<typeof ClockWidget>[0]['config']}
          onConfigChange={readOnly ? undefined : onConfigChange as Parameters<typeof ClockWidget>[0]['onConfigChange']}
        />
      )
    case 'NOTE':
      return (
        <NoteWidget
          config={widget.config_json as Parameters<typeof NoteWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof NoteWidget>[0]['onConfigChange']}
          readOnly={readOnly}
        />
      )
    case 'TASKLIST':
      return (
        <TasklistWidget
          config={widget.config_json as Parameters<typeof TasklistWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof TasklistWidget>[0]['onConfigChange']}
          readOnly={readOnly}
        />
      )
    case 'CALENDAR':
      return (
        <CalendarWidget
          config={widget.config_json as Parameters<typeof CalendarWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof CalendarWidget>[0]['onConfigChange']}
          readOnly={readOnly}
        />
      )
    case 'WEEKLY_CALENDAR':
      return (
        <WeeklyCalendarWidget
          config={widget.config_json as Parameters<typeof WeeklyCalendarWidget>[0]['config']}
          userType={userType}
        />
      )
    case 'FILE_REF':
      return (
        <FileRefWidget
          config={widget.config_json as Parameters<typeof FileRefWidget>[0]['config']}
          onOpen={onOpenFile}
        />
      )
    case 'IMAGE_REF':
      return <ImageRefWidget config={widget.config_json as Parameters<typeof ImageRefWidget>[0]['config']} />
    case 'OGGI_IMPARO':
      return (
        <OggiImparoWidget
          config={widget.config_json as Parameters<typeof OggiImparoWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof OggiImparoWidget>[0]['onConfigChange']}
          userType={userType}
          sessionName={sessionName}
        />
      )
    default:
      return <div className="h-full flex items-center justify-center text-xs text-white/30">{widget.widget_type}</div>
  }
}
