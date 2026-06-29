import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

const FAQ_ITEMS = [
  {
    id: 'q1',
    question: 'What is a soft sensor model?',
    answer:
      'A soft sensor predicts physical values — temperature, pressure, quality — using machine learning models trained on historical sensor data. No additional hardware is required.',
  },
  {
    id: 'q2',
    question: 'How do I connect a node to a model?',
    answer:
      'Open the workspace, click a node on the canvas (View Mode), and use the Node Detail panel on the right to associate models. Models appear as dots at the bottom of the node card.',
  },
  {
    id: 'q3',
    question: 'What triggers an Alarm status?',
    answer:
      'A node enters Alarm status when any of its monitored values breaches the configured upper or lower threshold. Alarm has the highest severity and overrides Warning or Offline states in workspace roll-up.',
  },
  {
    id: 'q4',
    question: 'Can I export alert history?',
    answer:
      'Export of alert history is not yet available in the current version. This feature is planned for a future release.',
  },
  {
    id: 'q5',
    question: 'How do I delete a node?',
    answer:
      'Switch to Build Mode on the canvas, then click the red × button on the node card. Confirm the deletion in the two-step confirm prompt that appears.',
  },
  {
    id: 'q6',
    question: 'What does Offline status mean?',
    answer:
      'Offline means the node is not transmitting data. This may indicate a network issue, power loss, or a hardware fault. Offline nodes appear gray on the canvas and in the workspace status dot.',
  },
]

export function SectionFaq() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">
        Frequently Asked Questions
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Answers to the most common questions about SoftSensor.
      </p>
      <Accordion type="single" collapsible className="flex flex-col gap-2">
        {FAQ_ITEMS.map(item => (
          <AccordionItem
            key={item.id}
            value={item.id}
            className="bg-card border border-border rounded-xl px-4"
          >
            <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground pb-4">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
