import { ArrowUpRight, Award, PiggyBank, Plus } from 'lucide-react';
import { useDrip } from '../context';
import { getSavingsStreak } from '../lib/analytics';
import { money } from '../lib/format';
import { Amount, Card, SectionTitle } from './ui';

export default function SavingsCard() {
  const { data, openSavings } = useDrip();
  const savings = getSavingsStreak(data.registros);
  const next = [3, 7, 14, 30, 60, 100].find(days => days > savings.current);
  return (
    <Card className="savings-card">
      <SectionTitle title="Tu ahorro, creciendo contigo" eyebrow="UN HÁBITO QUE SUMA">
        <PiggyBank size={25} aria-hidden="true" />
      </SectionTitle>
      <div className="savings-summary">
        <span>Saldo ahorrado</span>
        <strong><Amount value={savings.balance} currency={data.config.moneda} /></strong>
        <small>Depositaste {money(savings.totalDeposits, data.config.moneda)} · Retiraste {money(savings.totalWithdrawals, data.config.moneda)}</small>
      </div>
      <div className="savings-days">
        <div><strong>{savings.current}</strong><span>días sin retirar</span></div>
        <div><Award size={18} aria-hidden="true" /><span>Mejor racha <strong>{savings.best} días</strong></span></div>
      </div>
      <p className="footnote">
        {savings.balance > 0
          ? next ? `Próxima meta: ${next} días. Sigue cuidando lo que ya construiste.` : 'Más de 100 días cuidando tu ahorro. Cada día cuenta.'
          : 'Haz un depósito para empezar tu racha de ahorro.'}
      </p>
      {savings.balance < 0 && <p className="error-message" role="alert">Tus retiros superan los depósitos registrados. Revisa tus movimientos de ahorro.</p>}
      <div className="savings-actions">
        <button className="button primary" onClick={() => openSavings('deposit')}><Plus size={18} />Depositar</button>
        <button className="button secondary" disabled={savings.balance <= 0} onClick={() => openSavings('withdraw')}><ArrowUpRight size={18} />Retirar</button>
      </div>
      <p className="footnote">El día del depósito es el día 0. Añadir dinero conserva la racha; cualquier retiro la reinicia. El saldo debe seguir siendo positivo.</p>
    </Card>
  );
}
