import { useState } from 'react';
import { useApp } from '../context';
import { PageHead, ResourceTable } from '../ui';
import ImportVehicles from './ImportVehicles';
import { checkinsCfg, contractsCfg, driversCfg, expensesCfg, fuelCfg, paymentsCfg, recordsCfg, schedulesCfg, tripsCfg, vehiclesCfg } from '../resources';

export function VehiclesPage() {
  const app = useApp();
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <>
      <PageHead title="Cars" sub="Every car, who is driving it, and its paperwork.">
        {app.can('manager') && <button className="btn ghost" onClick={() => setImporting(true)}>Import cars</button>}
      </PageHead>
      <ResourceTable key={version} cfg={vehiclesCfg(app)} />
      {importing && (
        <ImportVehicles
          onClose={() => setImporting(false)}
          onDone={n => { setVersion(v => v + 1); if (n) app.notify(`${n} car${n === 1 ? '' : 's'} imported`); }} />
      )}
    </>
  );
}

export function DriversPage() {
  const app = useApp();
  return <><PageHead title="Drivers" sub="Each driver's manager, car, amount owing and latest feedback." /><ResourceTable cfg={driversCfg(app)} /></>;
}

export function ContractsPage() {
  const app = useApp();
  return (
    <>
      <PageHead title="Contracts" sub="Work & pay agreements and daily hire of the electric cars. Starting a contract assigns the car to the driver." />
      <ResourceTable cfg={contractsCfg(app)} />
    </>
  );
}

export function PaymentsPage() {
  const app = useApp();
  return (
    <>
      <PageHead title="Payments" sub="Daily MTN MoMo payments. Drivers pay the day after they work, so a payment is recorded against the work date." />
      <ResourceTable cfg={paymentsCfg(app)} />
    </>
  );
}

export function CheckinsPage() {
  const app = useApp();
  return (
    <>
      <PageHead title="Driver check-ins" sub="Car condition, complaints, and whether each driver wants to keep working." />
      <ResourceTable cfg={checkinsCfg(app)} />
    </>
  );
}

export function TripsPage() {
  const app = useApp();
  return <><PageHead title="Trips" sub="Optional trip log. Completing a trip updates the odometer." /><ResourceTable cfg={tripsCfg(app)} /></>;
}

export function FuelPage() {
  const app = useApp();
  return <><PageHead title="Fuel" sub="Fuel the company pays for, if any." /><ResourceTable cfg={fuelCfg(app)} /></>;
}

export function ExpensesPage() {
  const app = useApp();
  return <><PageHead title="Expenses" sub="Insurance, licensing, tyres, fines and other company costs." /><ResourceTable cfg={expensesCfg(app)} /></>;
}

export function MaintenancePage() {
  const app = useApp();
  const [tab, setTab] = useState('records');
  return (
    <>
      <PageHead title="Maintenance" sub="Work orders and the service schedules that drive reminders." />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'records'} onClick={() => setTab('records')}>Work orders</button>
        <button role="tab" aria-selected={tab === 'schedules'} onClick={() => setTab('schedules')}>Service schedules</button>
      </div>
      {tab === 'records' ? <ResourceTable key="r" cfg={recordsCfg(app)} /> : <ResourceTable key="s" cfg={schedulesCfg(app)} />}
    </>
  );
}
