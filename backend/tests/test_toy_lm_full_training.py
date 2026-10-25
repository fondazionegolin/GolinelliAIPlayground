"""Regression: an epoch must train on the end of a book longer than the old limits."""
import importlib.util
import math
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

try:
    import torch
except ImportError:
    torch = None


@unittest.skipIf(torch is None, 'PyTorch is required for the training integration test')
class FullBookTrainingTest(unittest.TestCase):
    def test_entire_corpus_including_final_token_reaches_training(self):
        path = Path(__file__).resolve().parents[1] / 'app' / 'services' / 'toy_lm_trainer.py'
        spec = importlib.util.spec_from_file_location('toy_lm_trainer_full_book_test', path)
        trainer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(trainer)
        corpus = 'a ' * 110000 + 'z'
        vocab = trainer.build_toy_vocab(corpus, 'char')
        final_token = vocab['charToIndex']['z']
        targets_seen = []
        base_loss = torch.nn.CrossEntropyLoss

        class RecordingLoss(base_loss):
            def forward(self, inputs, targets):
                targets_seen.extend(targets.tolist())
                return super().forward(inputs, targets)

        events = []
        job = SimpleNamespace(job_id='full-book-test', stop_event=threading.Event(), current_epoch=0,
                              epoch_metrics=[], checkpoint_path=None, was_stopped=False, push=events.append)
        service = trainer.toy_lm_service
        original_threads = torch.get_num_threads()
        torch.set_num_threads(1)
        try:
            with tempfile.TemporaryDirectory() as temporary, patch.object(trainer, 'CHECKPOINT_DIR', temporary), \
                    patch.object(service, '_device', torch.device('cpu')), patch.object(service, '_persist_progress'), \
                    patch.object(trainer.nn, 'CrossEntropyLoss', RecordingLoss):
                service._train(job, corpus, {
                    'tokenMode': 'char', 'seqLen': 2, 'batchSize': 64000, 'embedDim': 2,
                    'hiddenSize': 2, 'numLayers': 1, 'totalEpochs': 1, 'metricEvery': 1,
                }, vocab, 0, None)
                self.assertTrue(Path(job.checkpoint_path).exists())
        finally:
            torch.set_num_threads(original_threads)
        self.assertEqual(len(targets_seen), len(corpus) - 2)
        self.assertIn(final_token, targets_seen)
        started = next(event for event in events if event['type'] == 'started')
        self.assertEqual(started['nBatches'], math.ceil((len(corpus) - 2) / 64000))
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(job.current_epoch, 1)


if __name__ == '__main__':
    unittest.main()
